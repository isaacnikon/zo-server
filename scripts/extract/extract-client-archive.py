#!/usr/bin/env python3
"""Extract all recoverable files from the Zodiac Online client attrres archive."""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from extract_gcg import lzw_decompress_faithful


ARCHIVE_FILE = Path("/home/nikon/Data/Zodiac Online/gcg/attrres.rc")
OUTPUT_ROOT = REPO_ROOT / "data" / "client-derived" / "archive"
MANIFEST_FILE = OUTPUT_ROOT / "attrres-manifest.json"

ASCII_NAME_RE = re.compile(rb"([A-Za-z0-9_./\\-]{3,})\x00")
TEXT_EXTENSIONS = {
    ".txt",
    ".lua",
    ".ini",
    ".shop",
    ".cfg",
    ".msd",
}


@dataclass(frozen=True)
class ArchiveEntry:
    name: str
    name_offset: int
    data_offset: int
    decompressed_size: int
    stored_size: int
    payload: bytes


def main() -> None:
    archive = ARCHIVE_FILE.read_bytes()
    entries = discover_entries(archive)

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    extracted_files = []
    for entry in entries:
        relative_path = build_output_path(entry)
        output_path = OUTPUT_ROOT / relative_path
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(entry.payload)
        extracted_files.append(
            {
                "name": entry.name,
                "nameOffset": entry.name_offset,
                "dataOffset": entry.data_offset,
                "decompressedSize": entry.decompressed_size,
                "storedSize": entry.stored_size,
                "outputPath": str(relative_path),
                "contentKind": classify_payload(entry),
            }
        )

    MANIFEST_FILE.write_text(
        json.dumps(
            {
                "source": str(ARCHIVE_FILE),
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "count": len(extracted_files),
                "entries": extracted_files,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(MANIFEST_FILE.resolve())
    print(len(extracted_files))


def discover_entries(archive: bytes) -> list[ArchiveEntry]:
    minimum_data_offset = find_minimum_data_offset(archive)
    candidates: list[ArchiveEntry] = []
    seen_offsets: set[tuple[int, int, int]] = set()

    for match in ASCII_NAME_RE.finditer(archive[:minimum_data_offset]):
        name = match.group(1).decode("ascii", "ignore")
        if name.startswith("GCRC"):
            continue
        if match.start() < 12:
            continue

        data_offset = int.from_bytes(archive[match.start() - 12 : match.start() - 8], "little")
        decompressed_size = int.from_bytes(archive[match.start() - 8 : match.start() - 4], "little")
        stored_size = int.from_bytes(archive[match.start() - 4 : match.start()], "little")

        if not is_plausible_file_entry(
            archive,
            name,
            minimum_data_offset,
            data_offset,
            decompressed_size,
            stored_size,
        ):
            continue

        key = (data_offset, decompressed_size, stored_size)
        if key in seen_offsets:
            continue

        raw = archive[data_offset : data_offset + stored_size]
        try:
            payload = lzw_decompress_faithful(raw, decompressed_size)
        except Exception:
            continue

        if len(payload) != decompressed_size:
            continue

        seen_offsets.add(key)
        candidates.append(
            ArchiveEntry(
                name=name,
                name_offset=match.start(),
                data_offset=data_offset,
                decompressed_size=decompressed_size,
                stored_size=stored_size,
                payload=payload,
            )
        )

    candidates.sort(key=lambda entry: entry.name_offset)
    return candidates


def find_minimum_data_offset(archive: bytes) -> int:
    minimum = len(archive)
    for match in ASCII_NAME_RE.finditer(archive[:200000]):
        if match.start() < 12:
            continue
        data_offset = int.from_bytes(archive[match.start() - 12 : match.start() - 8], "little")
        if 0 < data_offset < minimum:
            minimum = data_offset
    return minimum


def is_plausible_file_entry(
    archive: bytes,
    name: str,
    minimum_data_offset: int,
    data_offset: int,
    decompressed_size: int,
    stored_size: int,
) -> bool:
    if not name or len(name) < 3:
        return False
    if data_offset < minimum_data_offset or data_offset >= len(archive):
        return False
    if stored_size <= 0 or decompressed_size <= 0:
        return False
    if data_offset + stored_size > len(archive):
        return False
    if "/" in name:
        return False
    return True


def build_output_path(entry: ArchiveEntry) -> Path:
    safe_name = sanitize_name(entry.name)
    return Path(f"{entry.name_offset:08x}__{safe_name}")


def sanitize_name(name: str) -> str:
    sanitized = name.replace("\\", "__").replace("/", "__")
    return "".join(char if char.isalnum() or char in "._-" else "_" for char in sanitized)


def classify_payload(entry: ArchiveEntry) -> str:
    suffix = Path(entry.name).suffix.lower()
    if suffix in TEXT_EXTENSIONS or looks_like_text(entry.payload):
        return "text"
    return "binary"


def looks_like_text(payload: bytes) -> bool:
    sample = payload[:512]
    if not sample:
        return True
    printable = sum(1 for byte in sample if byte in (9, 10, 13) or 32 <= byte < 127)
    return printable / len(sample) >= 0.85


if __name__ == "__main__":
    main()
