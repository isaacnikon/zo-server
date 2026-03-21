#!/usr/bin/env python3
"""Extract per-scene map-sidebar NPC entries from script.gcg."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


SCRIPT_PATH = Path("/home/nikon/Data/Zodiac Online/script.gcg")
ROLEINFO_PATH = Path("/home/nikon/projects/zo-server/data/client-derived/roleinfo.json")

TITLE_RE = re.compile(r'macro_SetBigText\("¡ï([^"]+?)¡ï",3000,\s*63500\)')
ADD_MAP_NPC_RE = re.compile(
    r'macro_AddMapNpc\(\s*(\d+)\s*,\s*(\d+)\s*,\s*"(.*?)"\s*,\s*(\d+)\s*,\s*(\d+)\s*\)',
    re.S,
)


def unescape_name(raw: str) -> str:
    cleaned = raw.replace('""..macro_GetTypeNpcName(', "macro_GetTypeNpcName(").replace(')..""', ")")
    return cleaned.strip()


def load_role_names() -> dict[int, str]:
    payload = json.loads(ROLEINFO_PATH.read_text(encoding="utf-8"))
    return {int(entry["roleId"]): entry["name"] for entry in payload["entries"]}


def parse_blocks(text: str, role_names: dict[int, str]) -> list[dict]:
    titles = list(TITLE_RE.finditer(text))
    blocks: list[dict] = []

    for index, match in enumerate(titles):
        start = match.start()
        end = titles[index + 1].start() if index + 1 < len(titles) else len(text)
        title = match.group(1)
        block_text = text[start:end]

        entries = []
        for npc_match in ADD_MAP_NPC_RE.finditer(block_text):
            role_id = int(npc_match.group(1))
            flag_mask = int(npc_match.group(2))
            entries.append(
                {
                    "roleId": role_id,
                    "flagMask": flag_mask,
                    "showsUnderQuest": bool(flag_mask & 2),
                    "showsUnderFunction": bool(flag_mask & 4),
                    "nameExpr": unescape_name(npc_match.group(3)),
                    "resolvedName": role_names.get(role_id),
                    "x": int(npc_match.group(4)),
                    "y": int(npc_match.group(5)),
                }
            )

        blocks.append(
            {
                "blockIndex": index,
                "title": title,
                "offset": start,
                "mapSidebarNpcCount": len(entries),
                "mapSidebarNpcs": entries,
            }
        )

    return blocks


def main() -> None:
    query = " ".join(sys.argv[1:]).strip().lower()
    text = SCRIPT_PATH.read_text(encoding="latin1", errors="ignore")
    role_names = load_role_names()
    blocks = parse_blocks(text, role_names)

    if query:
        blocks = [block for block in blocks if query in block["title"].lower()]

    clusters: dict[str, dict] = {}
    for block in blocks:
        root_title = block["title"]
        if root_title.endswith(" Inn"):
            root_title = root_title[: -len(" Inn")]
        cluster = clusters.setdefault(
            root_title,
            {
                "rootTitle": root_title,
                "blockTitles": [],
                "blockIndexes": [],
                "totalSidebarNpcCount": 0,
                "blocks": [],
            },
        )
        cluster["blockTitles"].append(block["title"])
        cluster["blockIndexes"].append(block["blockIndex"])
        cluster["totalSidebarNpcCount"] += block["mapSidebarNpcCount"]
        cluster["blocks"].append(block)

    print(
        json.dumps(
            {
                "source": str(SCRIPT_PATH),
                "count": len(blocks),
                "blocks": blocks,
                "clusters": list(clusters.values()),
            },
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
