#!/usr/bin/env python3
"""Extract hidden mapnpcinfo Lua scripts from the client script blob."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INDEX_DUMP = Path("/tmp/script_index_4600000_4700000.bin")
DEFAULT_SCRIPT_BLOB = Path("/home/nikon/Data/Zodiac Online/script.gcg")
OUTPUT_DIR = REPO_ROOT / "data" / "client-derived" / "mapnpcinfo"
SCRIPTS_DIR = OUTPUT_DIR / "scripts"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"
REFERENCE_MANIFEST_PATH = MANIFEST_PATH
REFERENCE_SCRIPTS_DIR = SCRIPTS_DIR
IMAGE_BASE = 0x04600000
FILE_RECORD_SIZE = 0x40


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--index-dump",
        type=Path,
        default=None,
        help="Optional path to a dumped in-memory script index. If omitted, use cold-disk signature matching.",
    )
    parser.add_argument(
        "--script-blob",
        type=Path,
        default=DEFAULT_SCRIPT_BLOB,
        help=f"Path to the readable script blob (default: {DEFAULT_SCRIPT_BLOB})",
    )
    parser.add_argument(
        "--reference-manifest",
        type=Path,
        default=REFERENCE_MANIFEST_PATH,
        help=f"Reference manifest for cold-disk signature matching (default: {REFERENCE_MANIFEST_PATH})",
    )
    parser.add_argument(
        "--reference-scripts-dir",
        type=Path,
        default=REFERENCE_SCRIPTS_DIR,
        help=f"Reference script directory for cold-disk signature matching (default: {REFERENCE_SCRIPTS_DIR})",
    )
    return parser.parse_args()


def parse_file_records(index_dump: bytes) -> list[dict]:
    records: list[dict] = []
    seen_names: set[str] = set()

    for off in range(0, len(index_dump) - FILE_RECORD_SIZE + 1):
        record = index_dump[off : off + FILE_RECORD_SIZE]
        name_bytes = record[0x10:0x20].split(b"\x00", 1)[0]
        if not name_bytes or len(name_bytes) > 15:
            continue
        if not all(32 <= byte < 127 for byte in name_bytes):
            continue

        name = name_bytes.decode("ascii")
        if not name.endswith(".lua"):
            continue

        name_len = int.from_bytes(record[0x20:0x24], "little")
        if name_len != len(name):
            continue

        data_offset = int.from_bytes(record[0x28:0x2C], "little")
        size = int.from_bytes(record[0x2C:0x30], "little")
        kind = int.from_bytes(record[0x30:0x34], "little")
        archive_index = int.from_bytes(record[0x34:0x38], "little")
        flags_a = int.from_bytes(record[0x38:0x3C], "little")
        flags_b = int.from_bytes(record[0x3C:0x40], "little")

        if size <= 0 or size >= 50000:
            continue
        if data_offset < 0:
            continue

        key = f"{name}:{data_offset}:{size}"
        if key in seen_names:
            continue
        seen_names.add(key)

        records.append(
            {
                "recordOffset": off,
                "recordAddress": f"0x{IMAGE_BASE + off:08x}",
                "name": name,
                "dataOffset": data_offset,
                "size": size,
                "kind": kind,
                "archiveIndex": archive_index,
                "flagsA": flags_a,
                "flagsB": flags_b,
            }
        )

    return records


def classify_mapnpcinfo(records: list[dict], script_blob: bytes) -> list[dict]:
    extracted: list[dict] = []
    for record in records:
        start = record["dataOffset"]
        end = start + record["size"]
        if end > len(script_blob):
            continue

        payload = script_blob[start:end]
        text = payload.decode("latin1", errors="ignore")
        if "npcmapinfo" not in text:
            continue
        if record["name"] != "0.lua" and not re.fullmatch(r"\d+_\d+\.lua", record["name"]):
            continue

        map_id = None
        role_id = None
        if record["name"] != "0.lua":
            map_part, role_part = record["name"][:-4].split("_", 1)
            map_id = int(map_part)
            role_id = int(role_part)

        extracted.append(
            {
                **record,
                "mapId": map_id,
                "roleId": role_id,
                "textPreview": text[:160],
                "payload": payload,
            }
        )

    extracted.sort(key=lambda item: (item["mapId"] is None, item["mapId"] or -1, item["name"]))
    return extracted


def load_reference_entries(reference_manifest: Path, reference_scripts_dir: Path) -> list[dict]:
    if reference_manifest.exists():
        payload = json.loads(reference_manifest.read_text(encoding="utf-8"))
        entries = []
        for entry in payload.get("entries", []):
            if not isinstance(entry, dict):
                continue
            name = entry.get("name")
            if not isinstance(name, str) or not name.endswith(".lua"):
                continue
            script_path = reference_scripts_dir / name
            if not script_path.exists():
                continue
            map_id = entry.get("mapId")
            role_id = entry.get("roleId")
            entries.append(
                {
                    "name": name,
                    "mapId": map_id if isinstance(map_id, int) else None,
                    "roleId": role_id if isinstance(role_id, int) else None,
                    "payload": script_path.read_bytes(),
                }
            )
        if entries:
            return entries

    entries = []
    for script_path in sorted(reference_scripts_dir.glob("*.lua")):
        name = script_path.name
        if name == "0.lua":
            entries.append(
                {
                    "name": name,
                    "mapId": None,
                    "roleId": None,
                    "payload": script_path.read_bytes(),
                }
            )
            continue
        if not re.fullmatch(r"\d+_\d+\.lua", name):
            continue
        map_part, role_part = name[:-4].split("_", 1)
        entries.append(
            {
                "name": name,
                "mapId": int(map_part),
                "roleId": int(role_part),
                "payload": script_path.read_bytes(),
            }
        )
    return entries


def locate_entries_by_signature(reference_entries: list[dict], script_blob: bytes) -> list[dict]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for entry in reference_entries:
        grouped[hashlib.sha1(entry["payload"]).hexdigest()].append(entry)

    records: list[dict] = []
    for entries in grouped.values():
        payload = entries[0]["payload"]
        matches: list[int] = []
        start = 0
        while True:
            offset = script_blob.find(payload, start)
            if offset < 0:
                break
            matches.append(offset)
            start = offset + 1

        if len(matches) != len(entries):
            if len(entries) == 1 and entries[0]["name"] == "0.lua" and matches:
                matches = [sorted(matches)[0]]
            else:
                names = ", ".join(entry["name"] for entry in entries)
                raise RuntimeError(
                    f"reference payload occurrence mismatch for [{names}]: expected {len(entries)}, found {len(matches)}"
                )

        ordered_entries = sorted(
            entries,
            key=lambda entry: (
                entry.get("dataOffset") is None,
                entry.get("dataOffset") or -1,
                entry["name"],
            ),
        )
        for entry, offset in zip(ordered_entries, sorted(matches), strict=True):
            text = payload.decode("latin1", errors="ignore")
            records.append(
                {
                    "recordOffset": None,
                    "recordAddress": None,
                    "name": entry["name"],
                    "dataOffset": offset,
                    "size": len(payload),
                    "kind": None,
                    "archiveIndex": None,
                    "flagsA": None,
                    "flagsB": None,
                    "mapId": entry["mapId"],
                    "roleId": entry["roleId"],
                    "textPreview": text[:160],
                    "payload": payload,
                }
            )
    records.sort(key=lambda item: (item["mapId"] is None, item["mapId"] or -1, item["name"]))
    return records


def write_outputs(entries: list[dict], sources: dict) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    SCRIPTS_DIR.mkdir(parents=True, exist_ok=True)

    for old_file in SCRIPTS_DIR.glob("*.lua"):
        old_file.unlink()

    by_map: dict[str, list[dict]] = defaultdict(list)
    manifest_entries = []

    for entry in entries:
        output_path = SCRIPTS_DIR / entry["name"]
        output_path.write_bytes(entry["payload"])

        manifest_entry = {
            "name": entry["name"],
            "mapId": entry["mapId"],
            "roleId": entry["roleId"],
            "outputPath": str(output_path.relative_to(REPO_ROOT)),
            "recordAddress": entry["recordAddress"],
            "dataOffset": entry["dataOffset"],
            "size": entry["size"],
            "kind": entry["kind"],
            "archiveIndex": entry["archiveIndex"],
            "flagsA": entry["flagsA"],
            "flagsB": entry["flagsB"],
            "textPreview": entry["textPreview"],
        }
        manifest_entries.append(manifest_entry)

        map_key = "fallback" if entry["mapId"] is None else str(entry["mapId"])
        by_map[map_key].append(
            {
                "name": entry["name"],
                "roleId": entry["roleId"],
                "size": entry["size"],
                "dataOffset": entry["dataOffset"],
            }
        )

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sources": sources,
        "count": len(manifest_entries),
        "mapCount": sum(1 for key in by_map if key != "fallback"),
        "fallbackCount": len(by_map.get("fallback", [])),
        "maps": {key: value for key, value in sorted(by_map.items(), key=lambda item: (item[0] == "fallback", item[0]))},
        "entries": manifest_entries,
    }

    MANIFEST_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    index_dump = args.index_dump
    script_blob = args.script_blob
    reference_manifest = args.reference_manifest
    reference_scripts_dir = args.reference_scripts_dir

    if not script_blob.exists():
        raise FileNotFoundError(f"script blob not found: {script_blob}")

    script_bytes = script_blob.read_bytes()

    if index_dump is not None and index_dump.exists():
        index_bytes = index_dump.read_bytes()
        records = parse_file_records(index_bytes)
        entries = classify_mapnpcinfo(records, script_bytes)
        sources = {
            "mode": "index_dump",
            "indexDump": str(index_dump),
            "scriptBlob": str(script_blob),
        }
    else:
        reference_entries = load_reference_entries(reference_manifest, reference_scripts_dir)
        if not reference_entries:
            raise FileNotFoundError(
                f"no index dump provided and no reference scripts found under {reference_scripts_dir}"
            )
        entries = locate_entries_by_signature(reference_entries, script_bytes)
        sources = {
            "mode": "reference_signature",
            "referenceManifest": str(reference_manifest),
            "referenceScriptsDir": str(reference_scripts_dir),
            "scriptBlob": str(script_blob),
        }

    write_outputs(entries, sources)
    unique_map_count = len({entry["mapId"] for entry in entries if entry["mapId"] is not None})

    print(MANIFEST_PATH)
    print(json.dumps({"count": len(entries), "mapCount": unique_map_count}))


if __name__ == "__main__":
    main()
