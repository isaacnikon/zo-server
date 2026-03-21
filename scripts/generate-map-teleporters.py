#!/usr/bin/env python3
from __future__ import annotations

import json
import math
from pathlib import Path


MAPS_DIR = Path("data/client-derived/maps")
MAP_SUMMARY_PATH = MAPS_DIR / "map-summary.json"
SCREENSHOT_VALIDATIONS_PATH = MAPS_DIR / "screenshot-teleporter-validations.json"
OUTPUT_PATH = MAPS_DIR / "map-teleporters.json"


MANUAL_TELEPORT_LINKS = {
    (101, 1): {"mapId": 103, "mapName": "Bling Spring", "validation": "validated-manually"},
    (102, 1): {"mapId": 103, "mapName": "Bling Spring", "validation": "validated-manually"},
    (102, 2): {"mapId": 112, "mapName": "Cloud City", "validation": "ui-inferred"},
    (103, 1): {"mapId": 101, "mapName": "Rainbow Valley", "validation": "validated-manually"},
    (103, 2): {"mapId": 102, "mapName": "Bling Alley", "validation": "validated-manually"},
}

def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_screenshot_validations() -> dict[tuple[int, int], dict]:
    if not SCREENSHOT_VALIDATIONS_PATH.exists():
        return {}
    payload = load_json(SCREENSHOT_VALIDATIONS_PATH)
    by_key: dict[tuple[int, int], dict] = {}
    for entry in payload.get("validations", []):
        if not isinstance(entry.get("sourceMapId"), int) or not isinstance(entry.get("sceneScriptId"), int):
            continue
        by_key[(entry["sourceMapId"], entry["sceneScriptId"])] = {
            "displayLabel": entry.get("displayLabel"),
            "mapId": entry.get("targetMapId"),
            "mapName": entry.get("targetMapName"),
            "validation": entry.get("validation", "screenshot-validated"),
            "evidence": entry.get("evidence", []),
        }
    return by_key


def area_center(area: dict) -> tuple[float, float]:
    bbox = area.get("bbox") or {}
    return (
        (float(bbox.get("minX", 0)) + float(bbox.get("maxX", 0))) / 2.0,
        (float(bbox.get("minY", 0)) + float(bbox.get("maxY", 0))) / 2.0,
    )


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def nearest_effect_candidates(details: dict, center: tuple[float, float], limit: int = 3) -> list[dict]:
    candidates = []
    map_config = details.get("mapConfig") or {}
    for effect in map_config.get("portalEffectCandidates", []):
        effect_center = (float(effect.get("x", 0)), float(effect.get("y", 0)))
        candidates.append(
            {
                "assetName": effect.get("assetName"),
                "x": effect.get("x"),
                "y": effect.get("y"),
                "distance": round(distance(center, effect_center), 2),
                "source": effect.get("source"),
            }
        )
    candidates.sort(key=lambda entry: entry["distance"])
    return candidates[:limit]


def build_target_candidates(record: dict, area: dict, details: dict, screenshot_validations: dict[tuple[int, int], dict]) -> list[dict]:
    targets: list[dict] = []
    seen: set[tuple[object, object, object]] = set()

    manual = MANUAL_TELEPORT_LINKS.get((int(record["mapId"]), int(area["sceneScriptId"])))
    if manual:
        key = ("manual", manual["mapId"], manual["mapName"])
        seen.add(key)
        targets.append(
            {
                "mapId": manual["mapId"],
                "mapName": manual["mapName"],
                "x": None,
                "y": None,
                "source": "manual-link",
                "validation": manual["validation"],
                "authoritative": False,
            }
        )

    screenshot = screenshot_validations.get((int(record["mapId"]), int(area["sceneScriptId"])))
    if screenshot:
        key = ("screenshot", screenshot["mapId"], screenshot["mapName"])
        seen.add(key)
        targets.append(
            {
                "mapId": screenshot["mapId"],
                "mapName": screenshot["mapName"],
                "x": None,
                "y": None,
                "source": "screenshot-validation",
                "validation": screenshot["validation"],
                "displayLabel": screenshot["displayLabel"],
                "authoritative": False,
            }
        )

    for edge in record.get("connections", []):
        if edge.get("fromMapId") == record["mapId"]:
            target_map_id = edge.get("toMapId")
            target_map_name = edge.get("toMapName")
        elif edge.get("toMapId") == record["mapId"]:
            target_map_id = edge.get("fromMapId")
            target_map_name = edge.get("fromMapName")
        else:
            continue
        key = ("world", target_map_id, target_map_name)
        if key in seen:
            continue
        seen.add(key)
        targets.append(
            {
                "mapId": target_map_id,
                "mapName": target_map_name,
                "x": None,
                "y": None,
                "source": "worldmap-connection",
                "validation": edge.get("validation"),
                "authoritative": False,
            }
        )

    for transition in details.get("sceneTransitions", []):
        target = transition.get("target") or {}
        key = ("script", target.get("mapId"), target.get("mapName"))
        if key in seen:
            continue
        seen.add(key)
        targets.append(
            {
                "mapId": target.get("mapId"),
                "mapName": target.get("mapName"),
                "x": target.get("x"),
                "y": target.get("y"),
                "source": "script-transition",
                "validation": "script-extracted",
                "authoritative": False,
            }
        )

    return targets


def main() -> None:
    summary = load_json(MAP_SUMMARY_PATH)
    screenshot_validations = load_screenshot_validations()
    maps_out = []
    total_teleporters = 0

    for record in summary.get("maps", []):
        scene_path = record.get("sceneScriptAreasPath")
        if not scene_path:
            continue
        scene_doc = load_json(Path(scene_path))
        details = load_json(Path(record["mapDetailsPath"])) if record.get("mapDetailsPath") else {}
        teleporters = []
        for area in scene_doc.get("areas", []):
            center = area_center(area)
            screenshot = screenshot_validations.get((int(record["mapId"]), int(area["sceneScriptId"])))
            teleporters.append(
                {
                    "sceneScriptId": area.get("sceneScriptId"),
                    "componentIndex": area.get("componentIndex"),
                    "displayLabel": (screenshot or {}).get("displayLabel"),
                    "tileTypeValues": area.get("tileTypeValues", []),
                    "auxValues": area.get("auxValues", []),
                    "tileCount": area.get("tileCount", 0),
                    "bbox": area.get("bbox"),
                    "center": {"x": round(center[0], 2), "y": round(center[1], 2)},
                    "rowRuns": area.get("rowRuns", []),
                    "nearestPortalEffects": nearest_effect_candidates(details, center),
                    "targetCandidates": build_target_candidates(record, area, details, screenshot_validations),
                }
            )

        maps_out.append(
            {
                "mapId": record["mapId"],
                "mapName": record["mapName"],
                "sceneScriptAreasPath": scene_path,
                "teleporterCount": len(teleporters),
                "teleporters": teleporters,
            }
        )
        total_teleporters += len(teleporters)

    payload = {
        "source": {
            "mapSummary": str(MAP_SUMMARY_PATH),
            "generator": "scripts/generate-map-teleporters.py",
        },
        "summary": {
            "mapCount": len(maps_out),
            "teleporterCount": total_teleporters,
            "authoritativeForTeleportRouting": False,
        },
        "maps": maps_out,
    }

    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(OUTPUT_PATH)
    print(payload["summary"]["mapCount"])
    print(payload["summary"]["teleporterCount"])


if __name__ == "__main__":
    main()
