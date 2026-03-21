#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path


LABEL_INDEX_PATH = Path("/tmp/zo_teleporter_labels/label-index.json")
VALIDATIONS_PATH = Path("data/client-derived/maps/screenshot-teleporter-validations.json")
MAP_SUMMARY_PATH = Path("data/client-derived/maps/map-summary.json")
OUTPUT_PATH = Path("data/client-derived/maps/screenshot-map-identifiers.json")


MANUAL_TITLE_IDENTIFIER_MAP = {
    "title-601fcdb0ef2e": {"mapId": 108, "mapName": "Golden Path", "validation": "title-identified-manually"},
    "title-bd136cc61704": {"mapId": 112, "mapName": "Cloud City", "validation": "title-identified-manually"},
    "title-d1a9f6214340": {"mapId": 192, "mapName": "Underground Hall 1", "validation": "title-identified-manually"},
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    label_index = load_json(LABEL_INDEX_PATH)
    validations = load_json(VALIDATIONS_PATH) if VALIDATIONS_PATH.exists() else {"validations": []}
    map_summary = load_json(MAP_SUMMARY_PATH) if MAP_SUMMARY_PATH.exists() else {"maps": []}
    map_names_by_id = {
        entry.get("mapId"): entry.get("mapName")
        for entry in map_summary.get("maps", [])
        if isinstance(entry.get("mapId"), int)
    }

    screenshot_by_path = {
        record["screenshotPath"]: record
        for record in label_index.get("screenshots", [])
    }

    title_identifier_to_map: dict[str, dict] = {}
    conflicts: dict[str, list[dict]] = {}
    for entry in validations.get("validations", []):
        for evidence_path in entry.get("evidence", []):
            screenshot = screenshot_by_path.get(evidence_path)
            if not screenshot:
                continue
            title_identifier = screenshot.get("titleIdentifier")
            if not title_identifier:
                continue
            source_map_id = entry.get("sourceMapId")
            if isinstance(source_map_id, str) and source_map_id.isdigit():
                source_map_id = int(source_map_id)
            resolved = {
                "mapId": source_map_id,
                "mapName": entry.get("sourceMapName") or map_names_by_id.get(source_map_id),
                "validation": "title-identifier-from-screenshot-validation",
                "evidenceScreenshotPath": evidence_path,
            }
            existing = title_identifier_to_map.get(title_identifier)
            if existing and existing.get("mapId") != resolved.get("mapId"):
                conflicts.setdefault(title_identifier, [existing]).append(resolved)
                continue
            title_identifier_to_map[title_identifier] = resolved

    for title_identifier, resolved in MANUAL_TITLE_IDENTIFIER_MAP.items():
        existing = title_identifier_to_map.get(title_identifier)
        if existing and existing.get("mapId") != resolved.get("mapId"):
            conflicts.setdefault(title_identifier, [existing]).append(resolved)
            continue
        title_identifier_to_map[title_identifier] = resolved

    screenshots = []
    for record in label_index.get("screenshots", []):
        resolved = title_identifier_to_map.get(record.get("titleIdentifier"))
        screenshots.append(
            {
                "screenshotPath": record.get("screenshotPath"),
                "titleIdentifier": record.get("titleIdentifier"),
                "titleGroupId": record.get("titleGroupId"),
                "titleGroupCount": record.get("titleGroupCount"),
                "candidateCount": record.get("candidateCount", 0),
                "resolvedSourceMapId": None if not resolved else resolved.get("mapId"),
                "resolvedSourceMapName": None if not resolved else resolved.get("mapName"),
                "resolution": None if not resolved else resolved.get("validation"),
                "resolutionEvidenceScreenshotPath": None if not resolved else resolved.get("evidenceScreenshotPath"),
            }
        )

    payload = {
        "source": {
            "labelIndexPath": str(LABEL_INDEX_PATH),
            "validationPath": str(VALIDATIONS_PATH),
            "mapSummaryPath": str(MAP_SUMMARY_PATH),
            "generator": "scripts/build-screenshot-map-identifiers.py",
        },
        "summary": {
            "screenshotCount": len(screenshots),
            "resolvedCount": sum(1 for item in screenshots if item["resolvedSourceMapId"] is not None),
            "unresolvedCount": sum(1 for item in screenshots if item["resolvedSourceMapId"] is None),
            "uniqueResolvedTitleIdentifiers": len(title_identifier_to_map),
            "conflictCount": len(conflicts),
        },
        "conflicts": conflicts,
        "screenshots": screenshots,
    }
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(OUTPUT_PATH)
    print(payload["summary"]["screenshotCount"])
    print(payload["summary"]["resolvedCount"])


if __name__ == "__main__":
    main()
