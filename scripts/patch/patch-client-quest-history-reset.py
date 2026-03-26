#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib
import shutil
import sys


IMAGE_BASE = 0x400000
PATCH_ADDRESS = 0x44CD5C
PATCH_OFFSET = PATCH_ADDRESS - IMAGE_BASE

# FUN_0044cbf0 clears the quest history tree at entity+0xca8, but the stock
# client calls FUN_00449d50 there, which recurses using the wrong node-layout
# discriminator (+0x13). History nodes use the +0x15 layout and must be freed
# with FUN_00449d90 instead.
ORIGINAL_BYTES = bytes.fromhex("e8efcfffff")
PATCHED_BYTES = bytes.fromhex("e82fd0ffff")


def read_exact(path: pathlib.Path, offset: int, size: int) -> bytes:
    with path.open("rb") as handle:
        handle.seek(offset)
        return handle.read(size)


def write_exact(path: pathlib.Path, offset: int, payload: bytes) -> None:
    with path.open("r+b") as handle:
        handle.seek(offset)
        handle.write(payload)


def ensure_backup(path: pathlib.Path) -> pathlib.Path:
    backup_path = path.with_suffix(path.suffix + ".quest-history-reset.bak")
    if not backup_path.exists():
        shutil.copy2(path, backup_path)
    return backup_path


def patch(path: pathlib.Path) -> int:
    current = read_exact(path, PATCH_OFFSET, len(ORIGINAL_BYTES))
    if current == PATCHED_BYTES:
        print(f"already patched: {path}")
        return 0
    if current != ORIGINAL_BYTES:
        print(
            f"unexpected bytes at 0x{PATCH_ADDRESS:08x}: "
            f"expected {ORIGINAL_BYTES.hex()} got {current.hex()}",
            file=sys.stderr,
        )
        return 1

    backup_path = ensure_backup(path)
    write_exact(path, PATCH_OFFSET, PATCHED_BYTES)
    print(
        f"patched {path}\n"
        f"backup: {backup_path}\n"
        f"offset: 0x{PATCH_OFFSET:08x}\n"
        f"address: 0x{PATCH_ADDRESS:08x}\n"
        "retargeted quest-history clear from FUN_00449d50 to FUN_00449d90"
    )
    return 0


def restore(path: pathlib.Path) -> int:
    current = read_exact(path, PATCH_OFFSET, len(ORIGINAL_BYTES))
    if current == ORIGINAL_BYTES:
        print(f"already restored: {path}")
        return 0
    if current != PATCHED_BYTES:
        print(
            f"unexpected bytes at 0x{PATCH_ADDRESS:08x}: "
            f"expected {PATCHED_BYTES.hex()} got {current.hex()}",
            file=sys.stderr,
        )
        return 1

    write_exact(path, PATCH_OFFSET, ORIGINAL_BYTES)
    print(
        f"restored {path}\n"
        f"offset: 0x{PATCH_OFFSET:08x}\n"
        f"address: 0x{PATCH_ADDRESS:08x}"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Patch gc12.exe so the character-login quest-history reset frees "
            "the history tree with the correct node layout."
        )
    )
    parser.add_argument(
        "binary",
        nargs="?",
        default="/home/nikon/Data/Zodiac Online/gc12.exe",
        help="Path to gc12.exe",
    )
    parser.add_argument(
        "--restore",
        action="store_true",
        help="Restore the original bytes instead of patching",
    )
    args = parser.parse_args()

    binary_path = pathlib.Path(args.binary)
    if not binary_path.exists():
        print(f"file not found: {binary_path}", file=sys.stderr)
        return 1

    if args.restore:
        return restore(binary_path)
    return patch(binary_path)


if __name__ == "__main__":
    raise SystemExit(main())
