#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import tempfile
from pathlib import Path


DEFAULT_PID = 97193
DEFAULT_OUTPUT = Path("data/runtime/client-server-run-trace.jsonl")
TARGET_ADDRESS = 0x004322B0
SCENE_CLIENT_GLOBAL = 0x0064328C
LOCAL_PLAYER_X_OFFSET = 0x5B4
LOCAL_PLAYER_Y_OFFSET = 0x5B6


GDB_PYTHON = r"""
import gdb
import json
import time

OUTPUT_PATH = {output_path!r}
TARGET_SUBCMD = {target_subcmd}
SCENE_CLIENT_GLOBAL = {scene_client_global}
LOCAL_PLAYER_X_OFFSET = {local_player_x_offset}
LOCAL_PLAYER_Y_OFFSET = {local_player_y_offset}


def u32(expr: str) -> int:
    return int(gdb.parse_and_eval(expr)) & 0xFFFFFFFF


def u16_at(addr: int) -> int:
    inferior = gdb.selected_inferior()
    return int.from_bytes(inferior.read_memory(addr, 2).tobytes(), "little")


def u32_at(addr: int) -> int:
    inferior = gdb.selected_inferior()
    return int.from_bytes(inferior.read_memory(addr, 4).tobytes(), "little")


def i16_at(addr: int) -> int:
    value = u16_at(addr)
    return value - 0x10000 if value & 0x8000 else value


class ServerRunProbe(gdb.Breakpoint):
    def stop(self):
        esp = u32("$esp")
        ecx = u32("$ecx")
        caller = u32_at(esp)
        subcmd = u32_at(esp + 4) & 0xFF
        param2 = u32_at(esp + 8)
        param3 = u16_at(esp + 12)
        scene_client = u32_at(SCENE_CLIENT_GLOBAL)
        map_id = u16_at(scene_client) if scene_client else 0
        x = i16_at(ecx + LOCAL_PLAYER_X_OFFSET) if ecx else 0
        y = i16_at(ecx + LOCAL_PLAYER_Y_OFFSET) if ecx else 0

        if TARGET_SUBCMD >= 0 and subcmd != TARGET_SUBCMD:
            return False

        event = {{
            "ts": time.time(),
            "eip": u32("$eip"),
            "caller": caller,
            "this": ecx,
            "subcmd": subcmd,
            "param2": param2,
            "param3": param3,
            "mapId": map_id,
            "x": x,
            "y": y,
        }}

        with open(OUTPUT_PATH, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(event) + "\n")
            handle.flush()

        return False


ServerRunProbe("*0x{target_address:08x}")
gdb.execute("continue")
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Attach to gc12.exe and trace LocalPlayer_SendServerRunRequest hits "
            "to a JSONL file."
        )
    )
    parser.add_argument("--pid", type=int, default=DEFAULT_PID, help="PID of gc12.exe")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="JSONL output path",
    )
    parser.add_argument(
        "--subcmd",
        type=lambda value: int(value, 0),
        default=0x01,
        help="Filter to one server-run subcmd; use -1 for all",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    gdb_script = GDB_PYTHON.format(
        output_path=str(args.output.resolve()),
        target_subcmd=args.subcmd,
        target_address=TARGET_ADDRESS,
        scene_client_global=SCENE_CLIENT_GLOBAL,
        local_player_x_offset=LOCAL_PLAYER_X_OFFSET,
        local_player_y_offset=LOCAL_PLAYER_Y_OFFSET,
    )

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".gdb", delete=False) as handle:
        handle.write("set pagination off\n")
        handle.write("set confirm off\n")
        handle.write("python\n")
        handle.write(gdb_script)
        handle.write("\nend\n")
        script_path = Path(handle.name)

    cmd = [
        "gdb",
        "-q",
        "-p",
        str(args.pid),
        "-x",
        str(script_path),
    ]
    print("launch:", " ".join(shlex.quote(part) for part in cmd))
    print(f"writing trace to {args.output.resolve()}")
    try:
        return subprocess.call(cmd)
    finally:
        script_path.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
