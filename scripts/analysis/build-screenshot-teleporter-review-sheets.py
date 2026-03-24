#!/usr/bin/env python3
from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw


MAP_IDENTIFIERS_PATH = Path("data/client-derived/maps/screenshot-map-identifiers.json")
LABEL_INDEX_PATH = Path("/tmp/zo_teleporter_labels/label-index.json")
OUTPUT_ROOT = Path("/tmp/zo_teleporter_review_sheets")
LABEL_SHEETS_DIR = OUTPUT_ROOT / "label_sheets"
CONTEXT_SHEETS_DIR = OUTPUT_ROOT / "context_sheets"
INDEX_PATH = OUTPUT_ROOT / "sheet-index.json"

LABEL_TILE_W = 220
LABEL_TILE_H = 110
CONTEXT_TILE_W = 300
CONTEXT_TILE_H = 220
MARGIN = 12
COLS = 4
HEADER_H = 34
FOOTER_H = 34
BG = (24, 24, 24)
PANEL = (250, 248, 240)
TEXT = (20, 20, 20)
SUBTEXT = (70, 70, 70)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def fit_image(path: Path, width: int, height: int) -> Image.Image:
    image = Image.open(path).convert("RGB")
    image.thumbnail((width, height))
    canvas = Image.new("RGB", (width, height), PANEL)
    x = (width - image.width) // 2
    y = (height - image.height) // 2
    canvas.paste(image, (x, y))
    return canvas


def draw_group_sheet(entries: list[dict], title: str, tile_size: tuple[int, int], output_path: Path, crop_key: str) -> None:
    tile_w, tile_h = tile_size
    rows = max(1, math.ceil(len(entries) / COLS))
    width = MARGIN + COLS * (tile_w + MARGIN)
    height = HEADER_H + rows * (tile_h + FOOTER_H + MARGIN) + MARGIN
    sheet = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(sheet)
    draw.text((MARGIN, 10), title, fill=(240, 240, 240))

    for index, entry in enumerate(entries):
        row = index // COLS
        col = index % COLS
        x = MARGIN + col * (tile_w + MARGIN)
        y = HEADER_H + row * (tile_h + FOOTER_H + MARGIN)
        panel = Image.new("RGB", (tile_w, tile_h), PANEL)
        panel_img = fit_image(Path(entry[crop_key]), tile_w, tile_h)
        panel.paste(panel_img, (0, 0))
        sheet.paste(panel, (x, y))

        name = Path(entry["screenshotPath"]).name
        line1 = f"{entry.get('resolvedSourceMapName') or 'Unresolved'}"
        line2 = f"{name} #{entry.get('index', '?')}"
        draw.text((x, y + tile_h + 4), line1, fill=(240, 240, 240))
        draw.text((x, y + tile_h + 18), line2, fill=(180, 180, 180))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path)


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    LABEL_SHEETS_DIR.mkdir(parents=True, exist_ok=True)
    CONTEXT_SHEETS_DIR.mkdir(parents=True, exist_ok=True)

    identifiers = load_json(MAP_IDENTIFIERS_PATH)
    label_index = load_json(LABEL_INDEX_PATH)
    id_by_path = {entry["screenshotPath"]: entry for entry in identifiers.get("screenshots", [])}

    grouped: dict[str, list[dict]] = {}
    for screenshot in label_index.get("screenshots", []):
        source = id_by_path.get(screenshot["screenshotPath"], {})
        group_key = source.get("resolvedSourceMapName") or source.get("titleGroupId") or "unresolved"
        for candidate in screenshot.get("candidates", []):
            grouped.setdefault(group_key, []).append(
                {
                    "screenshotPath": screenshot["screenshotPath"],
                    "resolvedSourceMapName": source.get("resolvedSourceMapName"),
                    "titleGroupId": source.get("titleGroupId"),
                    "index": candidate.get("index"),
                    "labelCropPath": candidate.get("labelCropPath"),
                    "labelContextPath": candidate.get("labelContextPath"),
                }
            )

    sheet_records = []
    for group_key, entries in sorted(grouped.items(), key=lambda item: (item[0] is None, str(item[0]))):
        safe_key = str(group_key).lower().replace(" ", "-")
        label_sheet_path = LABEL_SHEETS_DIR / f"{safe_key}.png"
        context_sheet_path = CONTEXT_SHEETS_DIR / f"{safe_key}.png"
        title = f"{group_key} ({len(entries)} labels)"
        draw_group_sheet(entries, title, (LABEL_TILE_W, LABEL_TILE_H), label_sheet_path, "labelCropPath")
        draw_group_sheet(entries, title, (CONTEXT_TILE_W, CONTEXT_TILE_H), context_sheet_path, "labelContextPath")
        sheet_records.append(
            {
                "groupKey": group_key,
                "entryCount": len(entries),
                "labelSheetPath": str(label_sheet_path),
                "contextSheetPath": str(context_sheet_path),
            }
        )

    payload = {
        "source": {
            "mapIdentifiersPath": str(MAP_IDENTIFIERS_PATH),
            "labelIndexPath": str(LABEL_INDEX_PATH),
            "generator": "scripts/build-screenshot-teleporter-review-sheets.py",
        },
        "summary": {
            "groupCount": len(sheet_records),
            "sheetCount": len(sheet_records) * 2,
            "labelCount": sum(record["entryCount"] for record in sheet_records),
        },
        "groups": sheet_records,
    }
    INDEX_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(INDEX_PATH)
    print(payload["summary"]["groupCount"])
    print(payload["summary"]["labelCount"])


if __name__ == "__main__":
    main()
