#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import sys


IMAGE_BASE = 0x400000
DEFAULT_BINARY = pathlib.Path("/home/nikon/Data/Zodiac Online/gc12.exe")
DEFAULT_STATE = pathlib.Path("/tmp/gc12-skill-debug-traps.json")

TRAPS = {
    "skill_apply_overlay": 0x52028D,
    "skill_gate_entry": 0x52034C,
    "skill_gate_call": 0x520370,
    "skill_gate_branch": 0x52038D,
    "skill_effect_block": 0x520397,
}


def file_offset(address: int) -> int:
    return address - IMAGE_BASE


def read_exact(path: pathlib.Path, offset: int, size: int) -> bytes:
    with path.open("rb") as handle:
        handle.seek(offset)
        return handle.read(size)


def write_exact(path: pathlib.Path, offset: int, payload: bytes) -> None:
    with path.open("r+b") as handle:
        handle.seek(offset)
        handle.write(payload)


def ensure_backup(path: pathlib.Path) -> pathlib.Path:
    backup_path = path.with_suffix(path.suffix + ".skill-debug.bak")
    if not backup_path.exists():
        shutil.copy2(path, backup_path)
    return backup_path


def load_state(path: pathlib.Path) -> dict[str, str]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def save_state(path: pathlib.Path, state: dict[str, str]) -> None:
    path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")


def patch(binary: pathlib.Path, state_path: pathlib.Path) -> int:
    state = load_state(state_path)
    ensure_backup(binary)
    for name, address in TRAPS.items():
        offset = file_offset(address)
        current = read_exact(binary, offset, 1)
        if current == b"\xCC":
            continue
        state.setdefault(name, current.hex())
        write_exact(binary, offset, b"\xCC")
    save_state(state_path, state)
    print(f"patched {binary}")
    print(f"state: {state_path}")
    for name, address in TRAPS.items():
        print(f"{name}: 0x{address:08x}")
    return 0


def restore(binary: pathlib.Path, state_path: pathlib.Path) -> int:
    state = load_state(state_path)
    if not state:
        print(f"no saved trap state: {state_path}", file=sys.stderr)
        return 1
    for name, address in TRAPS.items():
        original_hex = state.get(name)
        if original_hex is None:
            continue
        write_exact(binary, file_offset(address), bytes.fromhex(original_hex))
    print(f"restored {binary}")
    print(f"state: {state_path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Patch gc12.exe with INT3 debug traps for skill packet decoding."
    )
    parser.add_argument("binary", nargs="?", default=str(DEFAULT_BINARY))
    parser.add_argument("--state", default=str(DEFAULT_STATE))
    parser.add_argument("--restore", action="store_true")
    args = parser.parse_args()

    binary = pathlib.Path(args.binary)
    state_path = pathlib.Path(args.state)
    if not binary.exists():
        print(f"file not found: {binary}", file=sys.stderr)
        return 1
    if args.restore:
        return restore(binary, state_path)
    return patch(binary, state_path)


if __name__ == "__main__":
    raise SystemExit(main())
