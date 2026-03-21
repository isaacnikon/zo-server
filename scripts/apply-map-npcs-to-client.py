#!/usr/bin/env python3
"""Rewrite client map NPC script blocks from extracted JSON data."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


DEFAULT_CLIENT_SCRIPT_FILES = [
    Path("/home/nikon/Data/Zodiac Online/script.gcg"),
    Path("/home/nikon/Data/Zodiac Online/gcg/script.gcg"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Apply extracted map NPC JSON back into the Zodiac Online client script files."
    )
    parser.add_argument("--json", type=Path, required=True, help="Map NPC JSON file to apply")
    parser.add_argument(
        "--client-script",
        type=Path,
        action="append",
        dest="client_scripts",
        help="Client script.gcg file to patch. Can be passed multiple times.",
    )
    parser.add_argument(
        "--backup-suffix",
        default=".bak-mapnpc",
        help="Suffix used for one-time backup files.",
    )
    return parser.parse_args()


def build_macro_block(payload: dict) -> str:
    lines = ["macro_ClearBigText()"]
    for npc in payload.get("npcs", []):
        name = str(npc.get("name", "")).replace("\\", "\\\\").replace('"', '\\"')
        npc_id = int(npc["npcId"])
        npc_type_id = int(npc["npcTypeId"])
        x = int(npc["x"])
        y = int(npc["y"])
        lines.append(f'macro_AddMapNpc({npc_id}, {npc_type_id},"{name}",{x},{y})')
    return "\n".join(lines)


def patch_script_text(script_text: str, map_name: str, replacement_block: str) -> str:
    anchor_candidates = [
        f'macro_SetBigText("¡ï{map_name}¡ï"',
        f'macro_SetBigText("��{map_name}��"',
    ]
    anchor_index = -1
    for anchor in anchor_candidates:
        anchor_index = script_text.find(anchor)
        if anchor_index != -1:
            break
    if anchor_index == -1:
        raise ValueError(f"could not find macro_SetBigText anchor for map {map_name!r}")

    block_start = script_text.rfind("macro_ClearBigText()", 0, anchor_index)
    if block_start == -1:
        raise ValueError(f"could not find macro_ClearBigText() block for map {map_name!r}")

    music_index = script_text.find("macro_PlayMusic(", block_start, anchor_index + 1)
    if music_index == -1:
        raise ValueError(f"could not find macro_PlayMusic() after NPC block for map {map_name!r}")

    return script_text[:block_start] + replacement_block + "\n\n" + script_text[music_index:]


def ensure_backup(path: Path, backup_suffix: str) -> None:
    backup_path = path.with_name(path.name + backup_suffix)
    if not backup_path.exists():
        backup_path.write_bytes(path.read_bytes())


def main() -> None:
    args = parse_args()
    payload = json.loads(args.json.read_text(encoding="utf-8"))
    map_name = str(payload["mapName"])
    replacement_block = build_macro_block(payload)
    client_scripts = args.client_scripts or DEFAULT_CLIENT_SCRIPT_FILES

    for script_path in client_scripts:
        original_text = script_path.read_text(encoding="latin1", errors="ignore")
        updated_text = patch_script_text(original_text, map_name, replacement_block)
        if updated_text == original_text:
            continue
        ensure_backup(script_path, args.backup_suffix)
        script_path.write_text(updated_text, encoding="latin1")
        print(f"patched {script_path}")


if __name__ == "__main__":
    main()
