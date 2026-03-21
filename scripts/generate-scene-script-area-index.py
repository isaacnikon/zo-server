#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path


MAPS_DIR = Path("data/client-derived/maps")
MAP_SUMMARY_PATH = MAPS_DIR / "map-summary.json"
OUTPUT_PATH = MAPS_DIR / "scene-script-areas.index.json"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    summary = load_json(MAP_SUMMARY_PATH)
    dumps = {}

    for path in sorted(MAPS_DIR.glob("[0-9][0-9][0-9]-*.scene-script-areas.json")):
      doc = load_json(path)
      map_id = int(doc["mapId"])
      dumps[map_id] = {
          "mapId": map_id,
          "mapName": doc.get("mapName"),
          "path": str(path),
          "componentCount": doc.get("componentCount", 0),
          "focusSceneScriptId": (doc.get("focusArea") or {}).get("sceneScriptId"),
          "focusTileCount": (doc.get("focusArea") or {}).get("tileCount"),
          "focusBbox": (doc.get("focusArea") or {}).get("bbox"),
      }

    captured = []
    missing = []
    for record in summary.get("maps", []):
        map_id = int(record["mapId"])
        map_name = record["mapName"]
        dump = dumps.get(map_id)
        if dump:
            captured.append(dump)
        else:
            missing.append({
                "mapId": map_id,
                "mapName": map_name,
                "mapDetailsPath": record.get("mapDetailsPath"),
                "worldMapNode": (record.get("worldMap") or {}).get("nodeName"),
            })

    payload = {
        "source": {
            "mapSummary": str(MAP_SUMMARY_PATH),
            "generator": "scripts/generate-scene-script-area-index.py",
        },
        "summary": {
            "capturedCount": len(captured),
            "missingCount": len(missing),
            "totalMaps": len(captured) + len(missing),
        },
        "captured": captured,
        "missing": missing,
    }

    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(OUTPUT_PATH)
    print(payload["summary"]["capturedCount"])
    print(payload["summary"]["missingCount"])


if __name__ == "__main__":
    main()
