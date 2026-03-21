#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path


SCREENSHOT_MAP_IDENTIFIERS_PATH = Path("data/client-derived/maps/screenshot-map-identifiers.json")
LABEL_INDEX_PATH = Path("/tmp/zo_teleporter_labels/label-index.json")
MAP_TELEPORTERS_PATH = Path("data/client-derived/maps/map-teleporters.json")
OUTPUT_PATH = Path("data/client-derived/maps/screenshot-teleporter-match-candidates.json")


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def label_side(label_bbox: dict) -> str:
    center_x = float(label_bbox.get("x", 0)) + float(label_bbox.get("w", 0)) / 2.0
    if center_x < 240:
        return "left"
    if center_x > 420:
        return "right"
    return "middle"


def teleporter_side(teleporter_bbox: dict) -> str:
    center_x = (float(teleporter_bbox.get("minX", 0)) + float(teleporter_bbox.get("maxX", 0))) / 2.0
    if center_x < 24:
        return "left"
    if center_x > 102:
        return "right"
    return "middle"


def center_y_from_label(label_bbox: dict) -> float:
    return float(label_bbox.get("y", 0)) + float(label_bbox.get("h", 0)) / 2.0


def center_y_from_teleporter(teleporter_bbox: dict) -> float:
    return (float(teleporter_bbox.get("minY", 0)) + float(teleporter_bbox.get("maxY", 0))) / 2.0


def side_distance(left: str, right: str) -> int:
    order = {"left": 0, "middle": 1, "right": 2}
    return abs(order[left] - order[right])


def main() -> None:
    screenshot_ids = load_json(SCREENSHOT_MAP_IDENTIFIERS_PATH)
    label_index = load_json(LABEL_INDEX_PATH)
    map_teleporters = load_json(MAP_TELEPORTERS_PATH)

    labels_by_screenshot = {
        entry["screenshotPath"]: entry
        for entry in label_index.get("screenshots", [])
    }
    teleporters_by_map = {
        entry["mapId"]: entry
        for entry in map_teleporters.get("maps", [])
    }

    screenshots = []
    for screenshot in screenshot_ids.get("screenshots", []):
        source_map_id = screenshot.get("resolvedSourceMapId")
        if not isinstance(source_map_id, int):
            continue

        label_record = labels_by_screenshot.get(screenshot["screenshotPath"])
        teleporter_record = teleporters_by_map.get(source_map_id)
        if not label_record or not teleporter_record:
            continue

        labels = list(label_record.get("candidates", []))
        teleporters = list(teleporter_record.get("teleporters", []))
        if not labels or not teleporters:
            continue

        labels_sorted = sorted(labels, key=lambda item: center_y_from_label(item.get("bbox", {})))
        teleporters_sorted = sorted(teleporters, key=lambda item: center_y_from_teleporter(item.get("bbox", {})))

        label_rank_map = {candidate["index"]: index for index, candidate in enumerate(labels_sorted)}
        teleporter_rank_map = {
            int(teleporter.get("sceneScriptId", 0)): index
            for index, teleporter in enumerate(teleporters_sorted)
            if isinstance(teleporter.get("sceneScriptId"), int)
        }

        label_matches = []
        for candidate in labels:
            bbox = candidate.get("bbox", {})
            candidate_side = label_side(bbox)
            candidate_rank = label_rank_map[candidate["index"]]
            ranked_matches = []
            for teleporter in teleporters:
                tele_bbox = teleporter.get("bbox", {})
                tele_side = teleporter_side(tele_bbox)
                scene_script_id = teleporter.get("sceneScriptId")
                tele_rank = teleporter_rank_map.get(scene_script_id, 0)
                match_score = (
                    side_distance(candidate_side, tele_side) * 100
                    + abs(candidate_rank - tele_rank) * 10
                    + abs(center_y_from_label(bbox) - (90 + center_y_from_teleporter(tele_bbox) * 1.1)) / 50.0
                )
                ranked_matches.append(
                    {
                        "sceneScriptId": scene_script_id,
                        "displayLabel": teleporter.get("displayLabel"),
                        "teleporterSide": tele_side,
                        "teleporterBbox": tele_bbox,
                        "targetCandidates": teleporter.get("targetCandidates", []),
                        "score": round(match_score, 2),
                    }
                )
            ranked_matches.sort(key=lambda entry: entry["score"])
            label_matches.append(
                {
                    "index": candidate.get("index"),
                    "bbox": bbox,
                    "labelSide": candidate_side,
                    "labelCropPath": candidate.get("labelCropPath"),
                    "labelContextPath": candidate.get("labelContextPath"),
                    "matches": ranked_matches[:3],
                }
            )

        screenshots.append(
            {
                "screenshotPath": screenshot.get("screenshotPath"),
                "resolvedSourceMapId": source_map_id,
                "resolvedSourceMapName": screenshot.get("resolvedSourceMapName"),
                "titleIdentifier": screenshot.get("titleIdentifier"),
                "titleGroupId": screenshot.get("titleGroupId"),
                "candidateCount": screenshot.get("candidateCount", 0),
                "teleporterCount": teleporter_record.get("teleporterCount", 0),
                "labelMatches": label_matches,
            }
        )

    payload = {
        "source": {
            "screenshotMapIdentifiersPath": str(SCREENSHOT_MAP_IDENTIFIERS_PATH),
            "labelIndexPath": str(LABEL_INDEX_PATH),
            "mapTeleportersPath": str(MAP_TELEPORTERS_PATH),
            "generator": "scripts/build-screenshot-teleporter-match-candidates.py",
        },
        "summary": {
            "resolvedScreenshotCount": len(screenshots),
            "totalLabelCount": sum(len(entry["labelMatches"]) for entry in screenshots),
        },
        "screenshots": screenshots,
    }
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(OUTPUT_PATH)
    print(payload["summary"]["resolvedScreenshotCount"])
    print(payload["summary"]["totalLabelCount"])


if __name__ == "__main__":
    main()
