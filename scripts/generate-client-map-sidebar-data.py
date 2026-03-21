#!/usr/bin/env python3
"""Generate a client map-sidebar NPC dataset from static and runtime evidence."""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = Path("/home/nikon/Data/Zodiac Online/script.gcg")
SCENES_PATH = REPO_ROOT / "data" / "scenes" / "scenes.json"
ROLEINFO_PATH = REPO_ROOT / "data" / "client-derived" / "roleinfo.json"
STATIC_OUTPUT = REPO_ROOT / "data" / "client-derived" / "map-sidebar-npcs.json"
RUNTIME_CAPTURE_GLOB = "*-runtime-mapnpclist.json"
TITLE_ALIASES = {
    "ancietn road": "ancient road",
    "de evil tower 4": "tower 4",
    "eden garden": "eden",
    "fally alley": "fall alley",
    "goal mansion": "goal s mansion",
    "love pavillion": "love pavilion",
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_role_names() -> dict[int, str]:
    payload = load_json(ROLEINFO_PATH)
    return {int(entry["roleId"]): entry["name"] for entry in payload["entries"]}


def load_scenes() -> dict[str, dict]:
    return load_json(SCENES_PATH)["scenes"]


def normalize_title(value: str | None) -> str:
    text = (value or "").strip().lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return TITLE_ALIASES.get(text, text)


def parse_static_sidebar_blocks(role_names: dict[int, str]) -> list[dict]:
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "extract_map_sidebar_npcs",
        REPO_ROOT / "scripts" / "extract-map-sidebar-npcs.py",
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load extract-map-sidebar-npcs.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    text = SCRIPT_PATH.read_text(encoding="latin1", errors="ignore")
    return module.parse_blocks(text, role_names)


def discover_runtime_captures() -> list[dict]:
    captures = []
    for path in sorted((REPO_ROOT / "data" / "client-derived").glob(RUNTIME_CAPTURE_GLOB)):
        payload = load_json(path)
        captures.append(
            {
                "path": str(path),
                "mapName": payload.get("mapName"),
                "capturedAt": payload.get("capturedAt"),
                "count": payload.get("count", 0),
                "rows": payload.get("rows", []),
            }
        )
    return captures


def build_scene_lookup(scenes: dict[str, dict]) -> tuple[dict[str, list[dict]], dict[str, list[dict]]]:
    exact_lookup: dict[str, list[dict]] = {}
    normalized_lookup: dict[str, list[dict]] = {}
    for scene in scenes.values():
        name = str(scene.get("name", "")).strip()
        exact_lookup.setdefault(name.lower(), []).append(scene)
        normalized_lookup.setdefault(normalize_title(name), []).append(scene)
    return exact_lookup, normalized_lookup


def match_scene_candidates(
    exact_lookup: dict[str, list[dict]],
    normalized_lookup: dict[str, list[dict]],
    title: str | None,
) -> tuple[list[dict], str]:
    if not title:
        return [], "missing_title"
    exact_matches = exact_lookup.get(title.strip().lower(), [])
    if exact_matches:
        if len(exact_matches) == 1:
            return exact_matches, "exact_unique"
        return exact_matches, "exact_ambiguous"
    normalized_matches = normalized_lookup.get(normalize_title(title), [])
    if normalized_matches:
        if len(normalized_matches) == 1:
            return normalized_matches, "normalized_unique"
        return normalized_matches, "normalized_ambiguous"
    return [], "unmatched"


def annotate_rows(rows: list[dict], width: int, height: int) -> list[dict]:
    annotated = []
    for row in rows:
        x = int(row["x"])
        y = int(row["y"])
        annotated.append(
            {
                **row,
                "outOfBounds": width > 0 and height > 0 and not (0 <= x < width and 0 <= y < height),
            }
        )
    return annotated


def summarize_rows(rows: list[dict]) -> dict:
    counter = Counter(int(row["roleId"]) for row in rows)
    return {
        "count": len(rows),
        "outOfBoundsCount": sum(1 for row in rows if row.get("outOfBounds")),
        "duplicateRoleIds": {str(role_id): count for role_id, count in sorted(counter.items()) if count > 1},
    }


def scene_record_template(scene_id: str, scene: dict) -> dict:
    dims = scene.get("mapDimensions") or {}
    return {
        "sceneId": int(scene_id),
        "sceneName": scene.get("name"),
        "mapDimensions": dims,
        "staticBlocks": [],
        "runtimeCaptures": [],
    }


def main() -> None:
    role_names = load_role_names()
    scenes = load_scenes()
    exact_lookup, normalized_lookup = build_scene_lookup(scenes)
    static_blocks = parse_static_sidebar_blocks(role_names)
    runtime_captures = discover_runtime_captures()
    scenes_index = {scene_id: scene_record_template(scene_id, scene) for scene_id, scene in scenes.items()}

    static_records = []
    for block in static_blocks:
        scene_matches, match_strategy = match_scene_candidates(exact_lookup, normalized_lookup, block["title"])
        primary_scene = scene_matches[0] if len(scene_matches) == 1 else None
        dims = (primary_scene or {}).get("mapDimensions") or {}
        width = int(dims.get("width", 0) or 0)
        height = int(dims.get("height", 0) or 0)
        rows = annotate_rows(block["mapSidebarNpcs"], width, height)
        record = {
            "title": block["title"],
            "blockIndex": block["blockIndex"],
            "offset": block["offset"],
            "matchStrategy": match_strategy,
            "matchedSceneIds": [int(scene["id"]) for scene in scene_matches],
            "matchedSceneNames": [scene["name"] for scene in scene_matches],
            "sceneId": (primary_scene or {}).get("id"),
            "sceneName": (primary_scene or {}).get("name"),
            "mapDimensions": dims,
            "summary": summarize_rows(rows),
            "rows": rows,
        }
        static_records.append(record)
        for scene in scene_matches:
            scenes_index[str(scene["id"])]["staticBlocks"].append(
                {
                    "title": record["title"],
                    "blockIndex": record["blockIndex"],
                    "offset": record["offset"],
                    "matchStrategy": record["matchStrategy"],
                    "summary": record["summary"],
                    "rows": record["rows"],
                }
            )

    runtime_records = []
    for capture in runtime_captures:
        scene_matches, match_strategy = match_scene_candidates(exact_lookup, normalized_lookup, capture.get("mapName"))
        primary_scene = scene_matches[0] if len(scene_matches) == 1 else None
        dims = (primary_scene or {}).get("mapDimensions") or {}
        width = int(dims.get("width", 0) or 0)
        height = int(dims.get("height", 0) or 0)
        rows = annotate_rows(capture["rows"], width, height)
        record = {
            "path": capture["path"],
            "mapName": capture.get("mapName"),
            "capturedAt": capture.get("capturedAt"),
            "matchStrategy": match_strategy,
            "matchedSceneIds": [int(scene["id"]) for scene in scene_matches],
            "matchedSceneNames": [scene["name"] for scene in scene_matches],
            "sceneId": (primary_scene or {}).get("id"),
            "sceneName": (primary_scene or {}).get("name"),
            "mapDimensions": dims,
            "summary": summarize_rows(rows),
            "rows": rows,
        }
        runtime_records.append(record)
        for scene in scene_matches:
            scenes_index[str(scene["id"])]["runtimeCaptures"].append(
                {
                    "path": record["path"],
                    "mapName": record["mapName"],
                    "capturedAt": record["capturedAt"],
                    "matchStrategy": record["matchStrategy"],
                    "summary": record["summary"],
                    "rows": record["rows"],
                }
            )

    scene_records = []
    for scene_id, record in sorted(scenes_index.items(), key=lambda item: int(item[0])):
        static_rows = [row for block in record["staticBlocks"] for row in block["rows"]]
        runtime_rows = [row for capture in record["runtimeCaptures"] for row in capture["rows"]]
        scene_records.append(
            {
                **record,
                "summary": {
                    "staticBlockCount": len(record["staticBlocks"]),
                    "runtimeCaptureCount": len(record["runtimeCaptures"]),
                    "staticRowCount": len(static_rows),
                    "runtimeRowCount": len(runtime_rows),
                    "staticOutOfBoundsCount": sum(1 for row in static_rows if row.get("outOfBounds")),
                    "runtimeOutOfBoundsCount": sum(1 for row in runtime_rows if row.get("outOfBounds")),
                },
            }
        )

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sources": {
            "scriptGcg": str(SCRIPT_PATH),
            "scenes": str(SCENES_PATH),
            "roleinfo": str(ROLEINFO_PATH),
            "runtimeCaptureGlob": str((REPO_ROOT / "data" / "client-derived" / RUNTIME_CAPTURE_GLOB)),
        },
        "staticBlockCount": len(static_records),
        "runtimeCaptureCount": len(runtime_records),
        "sceneCount": len(scene_records),
        "coverage": {
            "scenesWithStaticBlocks": sum(1 for scene in scene_records if scene["summary"]["staticBlockCount"] > 0),
            "scenesWithRuntimeCaptures": sum(1 for scene in scene_records if scene["summary"]["runtimeCaptureCount"] > 0),
            "unmatchedStaticBlocks": sum(1 for record in static_records if not record["matchedSceneIds"]),
            "ambiguousStaticBlocks": sum(1 for record in static_records if len(record["matchedSceneIds"]) > 1),
            "unmatchedRuntimeCaptures": sum(1 for record in runtime_records if not record["matchedSceneIds"]),
            "ambiguousRuntimeCaptures": sum(1 for record in runtime_records if len(record["matchedSceneIds"]) > 1),
        },
        "staticBlocks": static_records,
        "runtimeCaptures": runtime_records,
        "scenes": scene_records,
    }

    STATIC_OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(STATIC_OUTPUT)
    print(json.dumps({"staticBlockCount": len(static_records), "runtimeCaptureCount": len(runtime_records)}))


if __name__ == "__main__":
    main()
