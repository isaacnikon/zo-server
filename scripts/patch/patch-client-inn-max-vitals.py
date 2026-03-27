#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib
import shutil
import sys


IMAGE_BASE = 0x400000

HOOK_ADDRESS = 0x004322B0
HOOK_OFFSET = HOOK_ADDRESS - IMAGE_BASE
HOOK_RETURN_ADDRESS = 0x004322BD
ORIGINAL_HOOK_BYTES = bytes.fromhex("535556578bf1e8c5ee0c008bf8")

CAVE_ADDRESS = 0x005C1E20
CAVE_OFFSET = CAVE_ADDRESS - IMAGE_BASE

ACQUIRE_PRIMARY_PACKET_BUILDER = 0x00501180
FLUSH_PRIMARY_PACKET_BUILDER = 0x005011A0
WRITE_UINT8 = 0x00588E50
WRITE_UINT16 = 0x00588EC0
WRITE_UINT32 = 0x00588F00

MAX_HP_COMPONENT_A_OFFSET = 0x478
MAX_HP_COMPONENT_B_OFFSET = 0x1F0
MAX_MP_COMPONENT_A_OFFSET = 0x47C
MAX_MP_COMPONENT_B_OFFSET = 0x1F4

CUSTOM_PLAYER_STATE_CMD = 0x03EF
CUSTOM_MAX_VITALS_SUBCMD = 0x2F
INN_REST_SUBCMD = 0x02
INN_REST_SCRIPT_ID = 0x1389


def read_exact(path: pathlib.Path, offset: int, size: int) -> bytes:
    with path.open("rb") as handle:
        handle.seek(offset)
        return handle.read(size)


def write_exact(path: pathlib.Path, offset: int, payload: bytes) -> None:
    with path.open("r+b") as handle:
        handle.seek(offset)
        handle.write(payload)


def ensure_backup(path: pathlib.Path) -> pathlib.Path:
    backup_path = path.with_suffix(path.suffix + ".bak")
    if not backup_path.exists():
        shutil.copy2(path, backup_path)
    return backup_path


def rel32(source_address: int, instruction_length: int, target_address: int) -> bytes:
    value = target_address - (source_address + instruction_length)
    return int(value).to_bytes(4, "little", signed=True)


class Assembler:
    def __init__(self, origin: int) -> None:
        self.origin = origin
        self.buffer = bytearray()
        self.labels: dict[str, int] = {}
        self.fixups: list[tuple[int, str, int]] = []

    def address(self) -> int:
        return self.origin + len(self.buffer)

    def emit(self, payload: bytes) -> None:
        self.buffer.extend(payload)

    def call(self, target: int) -> None:
        source = self.address()
        self.emit(b"\xE8" + rel32(source, 5, target))

    def jmp(self, target: int) -> None:
        source = self.address()
        self.emit(b"\xE9" + rel32(source, 5, target))

    def jne_label(self, label: str) -> None:
        source = self.address()
        self.emit(b"\x0F\x85\x00\x00\x00\x00")
        self.fixups.append((source + 2, label, source))

    def label(self, name: str) -> None:
        self.labels[name] = self.address()

    def finalize(self) -> bytes:
        for patch_offset, label, source in self.fixups:
            if label not in self.labels:
                raise ValueError(f"missing label: {label}")
            target = self.labels[label]
            self.buffer[patch_offset - self.origin : patch_offset - self.origin + 4] = rel32(
                source, 6, target
            )
        return bytes(self.buffer)


def build_cave_payload() -> bytes:
    asm = Assembler(CAVE_ADDRESS)
    asm.emit(b"\x53\x55\x56\x57\x8B\xF1")
    asm.emit(bytes([0x80, 0x7C, 0x24, 0x14, INN_REST_SUBCMD]))
    asm.jne_label("orig")
    asm.emit(
        b"\x66\x81\x7C\x24\x1C"
        + INN_REST_SCRIPT_ID.to_bytes(2, "little")
    )
    asm.jne_label("orig")

    asm.call(ACQUIRE_PRIMARY_PACKET_BUILDER)
    asm.emit(b"\x8B\xF8")

    asm.emit(b"\x68" + CUSTOM_PLAYER_STATE_CMD.to_bytes(4, "little"))
    asm.emit(b"\x8B\xCF")
    asm.call(WRITE_UINT16)

    asm.emit(bytes([0x6A, CUSTOM_MAX_VITALS_SUBCMD]))
    asm.emit(b"\x8B\xCF")
    asm.call(WRITE_UINT8)

    asm.emit(b"\x8B\x86" + MAX_HP_COMPONENT_A_OFFSET.to_bytes(4, "little"))
    asm.emit(b"\x03\x86" + MAX_HP_COMPONENT_B_OFFSET.to_bytes(4, "little"))
    asm.emit(b"\x50")
    asm.emit(b"\x8B\xCF")
    asm.call(WRITE_UINT32)

    asm.emit(b"\x8B\x86" + MAX_MP_COMPONENT_A_OFFSET.to_bytes(4, "little"))
    asm.emit(b"\x03\x86" + MAX_MP_COMPONENT_B_OFFSET.to_bytes(4, "little"))
    asm.emit(b"\x50")
    asm.emit(b"\x8B\xCF")
    asm.call(WRITE_UINT32)

    asm.emit(b"\x57")
    asm.call(FLUSH_PRIMARY_PACKET_BUILDER)
    asm.emit(b"\x83\xC4\x04")

    asm.label("orig")
    asm.call(ACQUIRE_PRIMARY_PACKET_BUILDER)
    asm.emit(b"\x8B\xF8")
    asm.jmp(HOOK_RETURN_ADDRESS)
    return asm.finalize()


PATCHED_CAVE_BYTES = build_cave_payload()
PATCHED_HOOK_BYTES = (
    b"\xE9" + rel32(HOOK_ADDRESS, 5, CAVE_ADDRESS) + (b"\x90" * (len(ORIGINAL_HOOK_BYTES) - 5))
)
ORIGINAL_CAVE_BYTES = bytes(len(PATCHED_CAVE_BYTES))


def patch(path: pathlib.Path) -> int:
    current_hook = read_exact(path, HOOK_OFFSET, len(ORIGINAL_HOOK_BYTES))
    current_cave = read_exact(path, CAVE_OFFSET, len(PATCHED_CAVE_BYTES))

    if current_hook == PATCHED_HOOK_BYTES and current_cave == PATCHED_CAVE_BYTES:
        print(f"already patched: {path}")
        return 0
    if current_hook != ORIGINAL_HOOK_BYTES:
        print(
            f"unexpected hook bytes at 0x{HOOK_ADDRESS:08x}: "
            f"expected {ORIGINAL_HOOK_BYTES.hex()} got {current_hook.hex()}",
            file=sys.stderr,
        )
        return 1
    if current_cave != ORIGINAL_CAVE_BYTES:
        print(
            f"unexpected cave bytes at 0x{CAVE_ADDRESS:08x}: "
            f"expected {ORIGINAL_CAVE_BYTES.hex()} got {current_cave.hex()}",
            file=sys.stderr,
        )
        return 1

    backup_path = ensure_backup(path)
    write_exact(path, HOOK_OFFSET, PATCHED_HOOK_BYTES)
    write_exact(path, CAVE_OFFSET, PATCHED_CAVE_BYTES)
    print(
        f"patched {path}\n"
        f"backup: {backup_path}\n"
        f"hook: 0x{HOOK_ADDRESS:08x}\n"
        f"cave: 0x{CAVE_ADDRESS:08x}\n"
        f"cave_size: {len(PATCHED_CAVE_BYTES)}"
    )
    return 0


def restore(path: pathlib.Path) -> int:
    current_hook = read_exact(path, HOOK_OFFSET, len(ORIGINAL_HOOK_BYTES))
    current_cave = read_exact(path, CAVE_OFFSET, len(PATCHED_CAVE_BYTES))

    if current_hook == ORIGINAL_HOOK_BYTES and current_cave == ORIGINAL_CAVE_BYTES:
        print(f"already restored: {path}")
        return 0
    if current_hook != PATCHED_HOOK_BYTES:
        print(
            f"unexpected hook bytes at 0x{HOOK_ADDRESS:08x}: "
            f"expected {PATCHED_HOOK_BYTES.hex()} got {current_hook.hex()}",
            file=sys.stderr,
        )
        return 1
    if current_cave != PATCHED_CAVE_BYTES:
        print(
            f"unexpected cave bytes at 0x{CAVE_ADDRESS:08x}: "
            f"expected {PATCHED_CAVE_BYTES.hex()} got {current_cave.hex()}",
            file=sys.stderr,
        )
        return 1

    write_exact(path, HOOK_OFFSET, ORIGINAL_HOOK_BYTES)
    write_exact(path, CAVE_OFFSET, ORIGINAL_CAVE_BYTES)
    print(
        f"restored {path}\n"
        f"hook: 0x{HOOK_ADDRESS:08x}\n"
        f"cave: 0x{CAVE_ADDRESS:08x}"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Patch gc12.exe so the inn-rest request first sends a custom "
            "0x03ef player-state packet carrying the client max HP/MP."
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
