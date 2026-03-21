#!/usr/bin/env python3
"""Generate structured map NPC info JSON from extracted hidden mapnpcinfo scripts."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPO_ROOT / "data" / "client-derived" / "mapnpcinfo" / "manifest.json"
SCRIPTS_DIR = REPO_ROOT / "data" / "client-derived" / "mapnpcinfo" / "scripts"
SCENES_PATH = REPO_ROOT / "data" / "scenes" / "scenes.json"
ROLEINFO_PATH = REPO_ROOT / "data" / "client-derived" / "roleinfo.json"
OUTPUT_PATH = REPO_ROOT / "data" / "client-derived" / "map-npc-info.json"

LEADING_THRESHOLD_RE = re.compile(r"^\s*(\d+)\s*\n")
OFFSET_RE = re.compile(r"offset\s*=\s*level\s*-\s*(\d+)")
DISPLAY_ENTRY_RE = re.compile(r"#2<(?P<color>\d+)><(?P<task>\d+)><0>(?P<title>[^\n\"]+)")
IF_BLOCK_RE = re.compile(
    r"""
    if\s*\(offset>3\)\s*then.*?
    \#2<(?P<high_color>\d+)><(?P<high_task>\d+)><0>(?P<high_title>[^\n\"]+).*?
    elseif\s*\(\(offset<3\)\s*and\s*\(offset>-3\)\)\s*then.*?
    \#2<(?P<mid_color>\d+)><(?P<mid_task>\d+)><0>(?P<mid_title>[^\n\"]+).*?
    else.*?
    \#2<(?P<low_color>\d+)><(?P<low_task>\d+)><0>(?P<low_title>[^\n\"]+).*?
    end
    """,
    re.S | re.X,
)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_role_names() -> dict[int, str]:
    payload = load_json(ROLEINFO_PATH)
    return {
        int(entry["roleId"]): str(entry.get("name") or f"Role {entry['roleId']}")
        for entry in payload.get("entries", [])
        if isinstance(entry, dict) and isinstance(entry.get("roleId"), int)
    }


def load_scenes() -> dict[str, dict]:
    payload = load_json(SCENES_PATH)
    return payload.get("scenes", {})


def clean_title(value: str) -> str:
    cleaned = value.replace("\\n", " ").strip()
    cleaned = cleaned.replace("£Û", "").replace("£Ý", "").strip()
    return cleaned


def parse_script_text(text: str) -> dict:
    leading_match = LEADING_THRESHOLD_RE.search(text)
    leading_threshold = int(leading_match.group(1)) if leading_match else None
    explicit_thresholds = [int(value) for value in OFFSET_RE.findall(text)]

    blocks = []
    matched_spans: list[tuple[int, int]] = []
    block_matches = list(IF_BLOCK_RE.finditer(text))
    for index, match in enumerate(block_matches):
        threshold = leading_threshold if index == 0 else (
            explicit_thresholds[index - 1] if index - 1 < len(explicit_thresholds) else None
        )
        task_ids = {
            int(match.group("high_task")),
            int(match.group("mid_task")),
            int(match.group("low_task")),
        }
        raw_titles = {
            "high": match.group("high_title"),
            "mid": match.group("mid_title"),
            "low": match.group("low_title"),
        }
        titles = {
            clean_title(raw_titles["high"]),
            clean_title(raw_titles["mid"]),
            clean_title(raw_titles["low"]),
        }
        block = {
            "sequence": index + 1,
            "recommendedLevel": threshold,
            "taskId": int(match.group("high_task")),
            "title": clean_title(raw_titles["high"]),
            "rawTitle": raw_titles["high"],
            "variants": {
                "playerLevelAboveRange": {
                    "condition": "offset > 3",
                    "colorCode": int(match.group("high_color")),
                },
                "playerLevelNearRange": {
                    "condition": "-3 < offset < 3",
                    "colorCode": int(match.group("mid_color")),
                },
                "playerLevelBelowOrBoundary": {
                    "condition": "otherwise",
                    "colorCode": int(match.group("low_color")),
                },
            },
            "clientBlockConsistent": len(task_ids) == 1 and len(titles) == 1,
        }
        blocks.append(block)
        matched_spans.append(match.span())

    extras = []
    for match in DISPLAY_ENTRY_RE.finditer(text):
        span = match.span()
        if any(start <= span[0] and span[1] <= end for start, end in matched_spans):
            continue
        extras.append(
            {
                "sequence": len(extras) + 1,
                "colorCode": int(match.group("color")),
                "targetId": int(match.group("task")),
                "title": clean_title(match.group("title")),
                "rawTitle": match.group("title"),
            }
        )

    return {
        "leadingThreshold": leading_threshold,
        "explicitThresholds": explicit_thresholds,
        "entries": blocks,
        "extraEntries": extras,
        "rawDisplayEntryCount": len(DISPLAY_ENTRY_RE.findall(text)),
        "parsedEntryCount": len(blocks),
    }


def build_scene_records(
    manifest: dict,
    scenes: dict[str, dict],
    role_names: dict[int, str],
) -> tuple[dict[str, dict], dict]:
    scene_records: dict[str, dict] = {}
    total_scripts = 0
    total_entries = 0
    total_extra_entries = 0

    entry_lookup = {
        str(item["name"]): item
        for item in manifest.get("entries", [])
        if isinstance(item, dict) and isinstance(item.get("name"), str)
    }

    for scene_id, scene in sorted(scenes.items(), key=lambda item: int(item[0])):
        scene_records[scene_id] = {
            "sceneId": int(scene_id),
            "sceneName": scene.get("name"),
            "npcScriptCount": 0,
            "taskEntryCount": 0,
            "extraEntryCount": 0,
            "npcs": [],
        }

    for script_path in sorted(SCRIPTS_DIR.glob("*.lua")):
        if script_path.name == "0.lua":
            continue
        manifest_entry = entry_lookup.get(script_path.name, {})
        map_id = manifest_entry.get("mapId")
        role_id = manifest_entry.get("roleId")
        if not isinstance(map_id, int) or not isinstance(role_id, int):
            continue

        scene_key = str(map_id)
        scene_record = scene_records.setdefault(
            scene_key,
            {
                "sceneId": map_id,
                "sceneName": None,
                "npcScriptCount": 0,
                "taskEntryCount": 0,
                "extraEntryCount": 0,
                "npcs": [],
            },
        )

        parsed = parse_script_text(script_path.read_text(encoding="latin1"))
        npc_record = {
            "roleId": role_id,
            "roleName": role_names.get(role_id),
            "scriptName": script_path.name,
            "scriptPath": str(script_path.relative_to(REPO_ROOT)),
            "recordAddress": manifest_entry.get("recordAddress"),
            "dataOffset": manifest_entry.get("dataOffset"),
            "size": manifest_entry.get("size"),
            "leadingThreshold": parsed["leadingThreshold"],
            "entries": parsed["entries"],
            "extraEntries": parsed["extraEntries"],
            "summary": {
                "taskEntryCount": len(parsed["entries"]),
                "extraEntryCount": len(parsed["extraEntries"]),
                "rawDisplayEntryCount": parsed["rawDisplayEntryCount"],
                "parsedEntryCount": parsed["parsedEntryCount"],
            },
        }
        scene_record["npcs"].append(npc_record)
        scene_record["npcScriptCount"] += 1
        scene_record["taskEntryCount"] += len(parsed["entries"])
        scene_record["extraEntryCount"] += len(parsed["extraEntries"])
        total_scripts += 1
        total_entries += len(parsed["entries"])
        total_extra_entries += len(parsed["extraEntries"])

    for scene_record in scene_records.values():
        scene_record["npcs"].sort(key=lambda item: (item["roleId"], item["scriptName"]))

    summary = {
        "sceneCount": len(scene_records),
        "scenesWithNpcInfo": sum(1 for scene in scene_records.values() if scene["npcScriptCount"] > 0),
        "npcScriptCount": total_scripts,
        "taskEntryCount": total_entries,
        "extraEntryCount": total_extra_entries,
    }
    return scene_records, summary


def main() -> None:
    manifest = load_json(MANIFEST_PATH)
    scenes = load_scenes()
    role_names = load_role_names()
    scene_records, summary = build_scene_records(manifest, scenes, role_names)

    fallback_path = SCRIPTS_DIR / "0.lua"
    fallback_text = fallback_path.read_text(encoding="latin1") if fallback_path.exists() else ""

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sources": {
            "manifest": str(MANIFEST_PATH),
            "scriptsDir": str(SCRIPTS_DIR),
            "scenes": str(SCENES_PATH),
            "roleinfo": str(ROLEINFO_PATH),
        },
        "clientSemantics": {
            "offsetFormula": "offset = playerLevel - recommendedLevel",
            "variantConditions": {
                "playerLevelAboveRange": "offset > 3",
                "playerLevelNearRange": "-3 < offset < 3",
                "playerLevelBelowOrBoundary": "otherwise",
            },
            "knownColorCodes": {
                "1": "playerLevelAboveRange",
                "9": "playerLevelNearRange",
                "5": "playerLevelBelowOrBoundary",
                "2": "specialLinkOrPostTextEntry",
            },
        },
        "fallbackScript": {
            "scriptName": "0.lua",
            "scriptPath": str(fallback_path.relative_to(REPO_ROOT)) if fallback_path.exists() else None,
            "textPreview": fallback_text[:160],
        },
        "summary": summary,
        "scenes": scene_records,
    }

    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(OUTPUT_PATH.resolve())
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
