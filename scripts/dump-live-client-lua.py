#!/usr/bin/env python3
"""Dump a Lua script payload from the live Zodiac Online client.

This attaches gdb to a running ``gc12.exe`` process, waits until the client
passes a decoded Lua buffer into the VM, then dumps that buffer to disk.

It is intended for virtual-pack scripts such as ``script\\mapnpcinfo\\0.lua``
that are not directly visible on disk.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


DEFAULT_PROCESS_PATTERN = "gc12.exe"
DEFAULT_OUTPUT = Path("/tmp/client-lua-dump.lua")
BREAKPOINT_MODES = {
    "vm": {
        "address": "0x0052b057",
        "commands": [
            'printf "PATH %s size=%d ptr=%p\\n", (char*)$ebp, $ebx, $edx',
            "dump binary memory {output} $edx $edx+$ebx",
        ],
    },
    "vfs": {
        "address": "0x0052af6f",
        "commands": [
            'printf "PATH %s size=%d ptr=%p\\n", (char*)$ebp, $eax, *(void**)($esp+0x1c)',
            "dump binary memory {output} *(char**)($esp+0x1c) *(char**)($esp+0x1c)+$eax",
        ],
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pattern",
        default="mapnpcinfo",
        help="Substring to match against the virtual Lua path inside the client.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Destination file for the dumped Lua payload (default: {DEFAULT_OUTPUT}).",
    )
    parser.add_argument(
        "--pid",
        type=int,
        default=None,
        help="Attach to an explicit gc12.exe PID instead of auto-detecting one.",
    )
    parser.add_argument(
        "--mode",
        choices=sorted(BREAKPOINT_MODES.keys()),
        default="vm",
        help="Hook the later VM handoff (`vm`) or the earlier virtual-filesystem return (`vfs`).",
    )
    return parser.parse_args()


def require_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise RuntimeError(f"Required tool not found on PATH: {name}")
    return path


def resolve_pid(explicit_pid: int | None) -> int:
    if explicit_pid is not None:
        return explicit_pid

    pgrep = require_tool("pgrep")
    result = subprocess.run(
        [pgrep, "-f", DEFAULT_PROCESS_PATTERN],
        check=False,
        capture_output=True,
        text=True,
    )
    candidates = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not candidates:
        raise RuntimeError("Could not find a running gc12.exe process.")
    return int(candidates[0])


def build_gdb_script(path_pattern: str, output_path: Path, mode: str) -> str:
    escaped_pattern = path_pattern.replace("\\", "\\\\").replace('"', '\\"')
    escaped_output = str(output_path).replace("\\", "\\\\").replace('"', '\\"')
    mode_config = BREAKPOINT_MODES[mode]
    command_lines = "\n".join(
        command.format(output=escaped_output) for command in mode_config["commands"]
    )
    return f"""
set pagination off
handle SIGQUIT nostop noprint pass
handle SIGPIPE nostop noprint pass
break *{mode_config["address"]} if (int)strstr((char*)$ebp,"{escaped_pattern}")
commands
silent
{command_lines}
detach
quit
end
continue
"""


def run() -> int:
    args = parse_args()
    gdb = require_tool("gdb")
    pid = resolve_pid(args.pid)
    output_path = args.output.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        output_path.unlink()

    script_body = build_gdb_script(args.pattern, output_path, args.mode)
    with tempfile.NamedTemporaryFile("w", delete=False, suffix=".gdb") as handle:
        handle.write(script_body)
        gdb_script_path = Path(handle.name)

    try:
        print(
            f"Attaching to pid={pid} pattern={args.pattern!r} mode={args.mode!r} "
            f"output={output_path}"
        )
        print("Trigger the relevant client action now. GDB will detach after the first matching load.")
        result = subprocess.run(
            [gdb, "-q", "-p", str(pid), "-x", str(gdb_script_path)],
            check=False,
            text=True,
        )
        if result.returncode != 0:
            print(f"gdb exited with code {result.returncode}", file=sys.stderr)
            return result.returncode
        if output_path.exists():
            print(f"Dump written to {output_path}")
            return 0
        print("No dump written. The target Lua path may not have reloaded.", file=sys.stderr)
        return 1
    finally:
        gdb_script_path.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(run())
