#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path


SCREENSHOT_DIR = Path("/home/nikon/Pictures/Screenshots")
VALIDATIONS_PATH = Path("data/client-derived/maps/screenshot-teleporter-validations.json")
OUTPUT_PATH = Path("data/client-derived/maps/screenshot-teleporter-review.json")


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    validations = load_json(VALIDATIONS_PATH) if VALIDATIONS_PATH.exists() else {"validations": []}
    evidence_to_links: dict[str, list[dict]] = {}
    for entry in validations.get("validations", []):
        for evidence in entry.get("evidence", []):
            evidence_to_links.setdefault(evidence, []).append(
                {
                    "sourceMapId": entry.get("sourceMapId"),
                    "sceneScriptId": entry.get("sceneScriptId"),
                    "displayLabel": entry.get("displayLabel"),
                    "targetMapId": entry.get("targetMapId"),
                    "targetMapName": entry.get("targetMapName"),
                    "validation": entry.get("validation"),
                }
            )

    screenshots = []
    for path in sorted(SCREENSHOT_DIR.glob("Screenshot_2026032*.png")):
        links = evidence_to_links.get(str(path), [])
        screenshots.append(
            {
                "path": str(path),
                "fileName": path.name,
                "status": "used-in-validation" if links else "reviewed-contact-sheet-no-extracted-link",
                "validationCount": len(links),
                "links": links,
            }
        )

    payload = {
        "source": {
            "validationFile": str(VALIDATIONS_PATH),
            "screenshotDir": str(SCREENSHOT_DIR),
            "generator": "scripts/generate-screenshot-review-index.py",
        },
        "summary": {
            "screenshotCount": len(screenshots),
            "usedInValidationCount": sum(1 for item in screenshots if item["validationCount"] > 0),
            "unusedAfterSheetReviewCount": sum(1 for item in screenshots if item["validationCount"] == 0),
        },
        "screenshots": screenshots,
    }
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(OUTPUT_PATH)
    print(payload["summary"]["screenshotCount"])
    print(payload["summary"]["usedInValidationCount"])


if __name__ == "__main__":
    main()
