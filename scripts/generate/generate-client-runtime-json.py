#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parents[2]
CLIENT_DERIVED_ROOT = REPO_ROOT / "data" / "client-derived"
ARCHIVE_ROOT = CLIENT_DERIVED_ROOT / "archive"

ARMOR_FILE = ARCHIVE_ROOT / "000005bb__is_armor.txt"
WEAPON_FILE = ARCHIVE_ROOT / "000006c3__is_weapon.txt"
GROWTH_FILE = ARCHIVE_ROOT / "00000557__chengzhang.txt"
SET_BONUS_FILE = ARCHIVE_ROOT / "000007a5__taozhuang.txt"
WASH_FILE = ARCHIVE_ROOT / "000007e5__xishou.txt"

EQUIPMENT_VALUE_OUTPUT = CLIENT_DERIVED_ROOT / "equipment-values.json"
ENHANCEMENT_TABLE_OUTPUT = CLIENT_DERIVED_ROOT / "enhancement-tables.json"


def parse_int(value: str) -> int | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        try:
            return int(float(text))
        except ValueError:
            return None


def read_rows(path: Path) -> list[list[str]]:
    with path.open("r", newline="", encoding="latin1") as handle:
        rows = []
        for row in csv.reader(handle):
            normalized = list(row)
            while normalized and not normalized[-1].strip():
                normalized.pop()
            rows.append(normalized)
        return rows


def parse_header(row: Iterable[str]) -> dict[str, int | str]:
    columns = list(row)
    return {
        "format": columns[0].strip() if len(columns) > 0 else "",
        "rowCount": parse_int(columns[1]) or 0,
        "columnCount": parse_int(columns[2]) or 0,
    }


def write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build_equipment_value_table() -> dict[str, object]:
    entries: list[dict[str, int | str]] = []
    sources = (
        ("armor", ARMOR_FILE),
        ("weapon", WEAPON_FILE),
    )
    for kind, source in sources:
        rows = read_rows(source)
        for row in rows[1:]:
            if len(row) <= 9:
                continue
            template_id = parse_int(row[0])
            value_field = parse_int(row[9])
            if not template_id or template_id <= 0 or not value_field or value_field <= 0:
                continue
            entries.append(
                {
                    "templateId": template_id,
                    "kind": kind,
                    "clientValueField": value_field,
                }
            )

    return {
        "source": {
            "armorFile": str(ARMOR_FILE),
            "weaponFile": str(WEAPON_FILE),
        },
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "count": len(entries),
        "entries": entries,
    }


def build_growth_rows() -> dict[str, object]:
    rows = read_rows(GROWTH_FILE)
    entries = []
    for row in rows[1:]:
        raw_values = [parse_int(value) or 0 for value in row]
        if not raw_values:
            continue
        growth_id = raw_values[0]
        if growth_id <= 0:
            continue
        entries.append(
            {
                "growthId": growth_id,
                "familyField": raw_values[1] if len(raw_values) > 1 else 0,
                "refineValues": raw_values[2:],
                "rawValues": raw_values,
            }
        )
    return {
        "sourceFile": str(GROWTH_FILE),
        "header": parse_header(rows[0]) if rows else {},
        "count": len(entries),
        "entries": entries,
    }


def build_set_bonus_rows() -> dict[str, object]:
    rows = read_rows(SET_BONUS_FILE)
    entries = []
    for row in rows[1:]:
        raw_values = [parse_int(value) or 0 for value in row]
        if not raw_values:
            continue
        set_id = raw_values[0]
        if set_id <= 0:
            continue
        bonus_pairs = []
        pair_values = raw_values[1:]
        for index in range(0, len(pair_values), 2):
            attribute_id = pair_values[index]
            bonus_value = pair_values[index + 1] if index + 1 < len(pair_values) else 0
            if attribute_id <= 0 and bonus_value <= 0:
                continue
            bonus_pairs.append(
                {
                    "attributeId": attribute_id,
                    "value": bonus_value,
                }
            )
        entries.append(
            {
                "setBonusId": set_id,
                "bonusPairs": bonus_pairs,
                "rawValues": raw_values,
            }
        )
    return {
        "sourceFile": str(SET_BONUS_FILE),
        "header": parse_header(rows[0]) if rows else {},
        "count": len(entries),
        "entries": entries,
    }


def build_wash_rows() -> dict[str, object]:
    rows = read_rows(WASH_FILE)
    entries = []
    for row in rows[1:]:
        raw_values = [parse_int(value) or 0 for value in row]
        if not raw_values:
            continue
        row_id = raw_values[0]
        if row_id < 0:
            continue
        entries.append(
            {
                "rowId": row_id,
                "tierField": raw_values[1] if len(raw_values) > 1 else 0,
                "costField": raw_values[2] if len(raw_values) > 2 else 0,
                "rateField": raw_values[3] if len(raw_values) > 3 else 0,
                "valueField": raw_values[4] if len(raw_values) > 4 else 0,
                "rawValues": raw_values,
            }
        )
    return {
        "sourceFile": str(WASH_FILE),
        "header": parse_header(rows[0]) if rows else {},
        "count": len(entries),
        "entries": entries,
    }


def build_enhancement_tables() -> dict[str, object]:
    return {
        "source": {
            "growthFile": str(GROWTH_FILE),
            "setBonusFile": str(SET_BONUS_FILE),
            "washFile": str(WASH_FILE),
        },
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "growth": build_growth_rows(),
        "setBonuses": build_set_bonus_rows(),
        "wash": build_wash_rows(),
    }


def main() -> None:
    write_json(EQUIPMENT_VALUE_OUTPUT, build_equipment_value_table())
    write_json(ENHANCEMENT_TABLE_OUTPUT, build_enhancement_tables())
    print(f"Wrote {EQUIPMENT_VALUE_OUTPUT.relative_to(REPO_ROOT)}")
    print(f"Wrote {ENHANCEMENT_TABLE_OUTPUT.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
