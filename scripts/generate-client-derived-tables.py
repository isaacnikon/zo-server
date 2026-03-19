#!/usr/bin/env python3
"""Generate client-derived item and quest tables from the packed client archive."""

from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_ROOT = REPO_ROOT / "data" / "client-derived"
RAW_OUTPUT_ROOT = OUTPUT_ROOT / "raw"
ARCHIVE_ROOT = OUTPUT_ROOT / "archive"
ARCHIVE_MANIFEST_FILE = ARCHIVE_ROOT / "attrres-manifest.json"

CLIENT_TABLES = {
    "equipment": "is_armor.txt",
    "weapons": "is_weapon.txt",
    "items": "is_general.txt",
    "potions": "is_potion.txt",
    "stuff": "is_stuff.txt",
    "iteminfo": "iteminfo.txt",
    "combinitem": "combinitem.txt",
    "weektask": "weektask.txt",
    "helpfiles": "helpfiles.txt",
    "roleinfo": "roleinfo.txt",
    "quests": "tasklist.txt",
}


def main() -> None:
    archive_manifest = load_archive_manifest()
    extracted = {
        table_name: extract_text_table(archive_manifest, archive_entry)
        for table_name, archive_entry in CLIENT_TABLES.items()
    }

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    RAW_OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

    for table in extracted.values():
        raw_path = RAW_OUTPUT_ROOT / table["archive_entry"]
        raw_path.write_text(table["text"], encoding="utf-8")

    generated_at = datetime.now(timezone.utc).isoformat()
    write_json(
        OUTPUT_ROOT / "equipment.json",
        {
            "source": build_source_info(extracted["equipment"]),
            "archiveEntry": extracted["equipment"]["archive_entry"],
            "generatedAt": generated_at,
            "count": 0,
            "entries": parse_equipment_rows(extracted["equipment"]["text"]),
        },
    )
    write_json(
        OUTPUT_ROOT / "weapons.json",
        {
            "source": build_source_info(extracted["weapons"]),
            "archiveEntry": extracted["weapons"]["archive_entry"],
            "generatedAt": generated_at,
            "count": 0,
            "entries": parse_weapon_rows(extracted["weapons"]["text"]),
        },
    )
    write_json(
        OUTPUT_ROOT / "items.json",
        {
            "source": build_source_info(extracted["items"]),
            "archiveEntry": extracted["items"]["archive_entry"],
            "generatedAt": generated_at,
            "count": 0,
            "entries": parse_general_item_rows(extracted["items"]["text"]),
        },
    )
    write_json(
        OUTPUT_ROOT / "potions.json",
        {
            "source": build_source_info(extracted["potions"]),
            "archiveEntry": extracted["potions"]["archive_entry"],
            "generatedAt": generated_at,
            "count": 0,
            "entries": parse_potion_rows(extracted["potions"]["text"]),
        },
    )
    write_json(
        OUTPUT_ROOT / "stuff.json",
        {
            "source": build_source_info(extracted["stuff"]),
            "archiveEntry": extracted["stuff"]["archive_entry"],
            "generatedAt": generated_at,
            "count": 0,
            "entries": parse_stuff_rows(extracted["stuff"]["text"]),
        },
    )
    write_json(
        OUTPUT_ROOT / "quests.json",
        {
            "source": build_source_info(extracted["quests"]),
            "archiveEntry": extracted["quests"]["archive_entry"],
            "generatedAt": generated_at,
            "count": 0,
            "entries": parse_quest_rows(extracted["quests"]["text"]),
        },
    )
    write_json(
        OUTPUT_ROOT / "iteminfo.json",
        {
            "source": build_source_info(extracted["iteminfo"]),
            "archiveEntry": extracted["iteminfo"]["archive_entry"],
            "generatedAt": generated_at,
            "count": 0,
            "entries": parse_iteminfo_rows(extracted["iteminfo"]["text"]),
        },
    )
    write_json(
        OUTPUT_ROOT / "combinitem.json",
        {
            "source": build_source_info(extracted["combinitem"]),
            "archiveEntry": extracted["combinitem"]["archive_entry"],
            "generatedAt": generated_at,
            "count": 0,
            "entries": parse_combinitem_rows(extracted["combinitem"]["text"]),
        },
    )
    write_json(
        OUTPUT_ROOT / "weektask.json",
        {
            "source": build_source_info(extracted["weektask"]),
            "archiveEntry": extracted["weektask"]["archive_entry"],
            "generatedAt": generated_at,
            "count": 0,
            "entries": parse_weektask_rows(extracted["weektask"]["text"]),
        },
    )
    write_json(
        OUTPUT_ROOT / "helpfiles.json",
        {
            "source": build_source_info(extracted["helpfiles"]),
            "archiveEntry": extracted["helpfiles"]["archive_entry"],
            "generatedAt": generated_at,
            "count": 0,
            "entries": parse_helpfiles_rows(extracted["helpfiles"]["text"]),
        },
    )
    write_json(
        OUTPUT_ROOT / "roleinfo.json",
        {
            "source": build_source_info(extracted["roleinfo"]),
            "archiveEntry": extracted["roleinfo"]["archive_entry"],
            "generatedAt": generated_at,
            "count": 0,
            "entries": parse_roleinfo_rows(extracted["roleinfo"]["text"]),
        },
    )
    roleinfo_entries = parse_roleinfo_rows(extracted["roleinfo"]["text"])
    write_json(
        OUTPUT_ROOT / "shops.json",
        {
            "source": {
                "manifest": str(ARCHIVE_MANIFEST_FILE),
                "archiveRoot": str(ARCHIVE_ROOT),
                "roleinfo": str((OUTPUT_ROOT / "roleinfo.json").resolve()),
            },
            "archiveEntryPattern": "*.shop",
            "generatedAt": generated_at,
            "count": 0,
            "entries": parse_shop_rows(archive_manifest, roleinfo_entries),
        },
    )

    for output_name in (
        "equipment.json",
        "weapons.json",
        "items.json",
        "potions.json",
        "stuff.json",
        "iteminfo.json",
        "combinitem.json",
        "weektask.json",
        "helpfiles.json",
        "roleinfo.json",
        "shops.json",
        "quests.json",
    ):
        print((OUTPUT_ROOT / output_name).resolve())


def load_archive_manifest() -> dict:
    return json.loads(ARCHIVE_MANIFEST_FILE.read_text(encoding="utf-8"))


def extract_text_table(archive_manifest: dict, archive_entry: str) -> dict:
    entry = next(
        (candidate for candidate in archive_manifest.get("entries", []) if candidate.get("name") == archive_entry),
        None,
    )
    if not entry:
        raise RuntimeError(f"Extracted archive entry not found: {archive_entry}")

    output_path = ARCHIVE_ROOT / entry["outputPath"]
    return {
        "archive_entry": archive_entry,
        "output_path": output_path,
        "text": decode_client_text(output_path.read_bytes()),
    }


def build_source_info(extracted: dict) -> dict:
    return {
        "manifest": str(ARCHIVE_MANIFEST_FILE),
        "extractedFile": str(extracted["output_path"]),
    }


def decode_client_text(raw: bytes) -> str:
    for encoding in ("utf-8", "gb18030", "gbk"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1")


def parse_equipment_rows(text: str) -> list[dict]:
    entries = []
    for row in iter_csv_rows(text):
        if len(row) < 25:
            continue
        entries.append(
            {
                "templateId": parse_int(row[0]),
                "name": row[1],
                "kind": "armor",
                "templateTierField": parse_int(row[2]),
                "clientTemplateFamily": parse_int(row[3]),
                "baseDurabilityField": parse_int(row[10]),
                "templateLevelField": parse_int(row[2]),
                "equipSlotField": parse_int(row[11]),
                "defaultInstanceFields": {
                    "defense": parse_int(row[13]),
                    "magicDefense": parse_int(row[19]),
                },
                "combatFields": parse_ints(row[12:23]),
                "iconPath": row[23],
                "restrictionFields": parse_ints(row[24:-1]),
                "description": row[-1],
                "rawColumnCount": len(row),
            }
        )
    return entries


def parse_weapon_rows(text: str) -> list[dict]:
    entries = []
    for row in iter_csv_rows(text):
        if len(row) < 29:
            continue
        entries.append(
            {
                "templateId": parse_int(row[0]),
                "name": row[1],
                "kind": "weapon",
                "templateTierField": parse_int(row[2]),
                "clientTemplateFamily": parse_int(row[3]),
                "baseDurabilityField": parse_int(row[10]),
                "templateLevelField": parse_int(row[2]),
                "equipSlotField": parse_int(row[11]),
                "defaultInstanceFields": {
                    "attackMin": parse_int(row[13]),
                    "attackMax": parse_int(row[15]),
                    "magicAttackMin": parse_int(row[17]),
                    "magicAttackMax": parse_int(row[19]),
                },
                "combatFields": parse_ints(row[12:28]),
                "iconPath": row[28],
                "restrictionFields": parse_ints(row[29:-1]),
                "description": row[-1],
                "rawColumnCount": len(row),
            }
        )
    return entries


def parse_general_item_rows(text: str) -> list[dict]:
    entries = []
    for row in iter_csv_rows(text):
        if len(row) < 25:
            continue
        entries.append(
            {
                "templateId": parse_int(row[0]),
                "name": row[1],
                "kind": "general",
                "templateTierField": parse_int(row[2]),
                "typeGroupField": parse_int(row[3]),
                "clientTemplateFamily": parse_int(row[4]),
                "usageFields": parse_ints(row[5:14]),
                "stackLimitField": parse_int(row[14]),
                "valueFields": parse_ints(row[15:20]),
                "iconPath": row[20],
                "bindField": parse_int(row[21]),
                "sortField": parse_int(row[22]),
                "shopField": parse_int(row[23]),
                "tooltipMarkup": row[24],
                "descriptionField": parse_int(row[25]) if len(row) > 25 else None,
                "description": row[26] if len(row) > 26 else "",
                "tailFields": parse_ints(row[27:]) if len(row) > 27 else [],
                "rawColumnCount": len(row),
            }
        )
    return entries


def parse_potion_rows(text: str) -> list[dict]:
    entries = []
    for row in iter_csv_rows(text):
        if len(row) < 26:
            continue
        entries.append(
            {
                "templateId": parse_int(row[0]),
                "name": row[1],
                "kind": "potion",
                "templateTierField": parse_int(row[2]),
                "typeGroupField": parse_int(row[3]),
                "clientTemplateFamily": parse_int(row[4]),
                "usageFields": parse_ints(row[5:11]),
                "stackLimitField": parse_int(row[11]),
                "effectFields": parse_ints(row[12:20]),
                "iconPath": row[20],
                "bindField": parse_int(row[21]),
                "sortField": parse_int(row[22]),
                "shopFieldA": parse_int(row[23]),
                "shopFieldB": parse_int(row[24]),
                "tooltipMarkup": row[25],
                "tailFields": parse_ints(row[26:]),
                "rawColumnCount": len(row),
            }
        )
    return entries


def parse_stuff_rows(text: str) -> list[dict]:
    entries = []
    for row in iter_csv_rows(text):
        if len(row) < 18:
            continue
        entries.append(
            {
                "templateId": parse_int(row[0]),
                "name": row[1],
                "kind": "stuff",
                "typeField": parse_int(row[2]),
                "levelField": parse_int(row[3]),
                "groupFields": parse_ints(row[4:12]),
                "iconPath": row[12],
                "bindField": parse_int(row[13]),
                "sortField": parse_int(row[14]),
                "shopField": parse_int(row[15]),
                "description": row[16],
                "tailFields": parse_ints(row[17:]),
                "rawColumnCount": len(row),
            }
        )
    return entries


def parse_quest_rows(text: str) -> list[dict]:
    entries = []
    for row in iter_csv_rows(text):
        if len(row) < 12:
            continue
        entries.append(
            {
                "taskId": parse_int(row[0]),
                "startNpcId": parse_int(row[1]),
                "title": row[2],
                "minLevel": parse_int(row[3]),
                "field4": parse_int(row[4]),
                "prerequisiteTaskId": parse_int(row[5]),
                "field6": parse_int(row[6]),
                "field7": parse_int(row[7]),
                "field8": parse_int(row[8]),
                "field9": parse_int(row[9]),
                "field10": parse_int(row[10]),
                "field11": parse_int(row[11]),
                "rawColumnCount": len(row),
            }
        )
    return entries


def parse_iteminfo_rows(text: str) -> list[dict]:
    entries = []
    for row in iter_csv_rows(text):
        if len(row) < 5:
            continue
        entries.append(
            {
                "templateId": parse_int(row[0]),
                "field1": parse_int(row[1]),
                "field2": parse_int(row[2]),
                "field3": parse_int(row[3]),
                "field4": parse_int(row[4]),
                "tailFields": parse_ints(row[5:]),
                "rawColumnCount": len(row),
            }
        )
    return entries


def parse_combinitem_rows(text: str) -> list[dict]:
    entries = []
    for row in iter_csv_rows(text):
        if len(row) < 10:
            continue
        entries.append(
            {
                "recipeId": parse_int(row[0]),
                "stepField": parse_int(row[1]),
                "materialTemplateId": parse_int(row[2]),
                "materialQuantity": parse_int(row[3]),
                "targetTemplateId": parse_int(row[4]),
                "targetQuantity": parse_int(row[5]),
                "stationTemplateId": parse_int(row[6]),
                "stationQuantity": parse_int(row[7]),
                "successRateField": parse_int(row[8]),
                "costField": parse_int(row[9]),
                "extraFields": parse_ints(row[10:]),
                "rawColumnCount": len(row),
            }
        )
    return entries


def parse_weektask_rows(text: str) -> list[dict]:
    entries = []
    for row in iter_csv_rows(text):
        if len(row) < 5:
            continue
        entries.append(
            {
                "entryId": parse_int(row[0]),
                "taskId": parse_int(row[1]),
                "periodSeconds": parse_int(row[2]),
                "levelField": parse_int(row[3]),
                "previousLevelGate": parse_int(row[4]),
                "tailFields": parse_ints(row[5:]),
                "rawColumnCount": len(row),
            }
        )
    return entries


def parse_helpfiles_rows(text: str) -> list[dict]:
    entries = []
    for row in iter_csv_rows(text):
        if not row:
            continue
        entries.append(
            {
                "helpId": parse_int(row[0]),
                "tailFields": parse_ints(row[1:]),
                "rawColumnCount": len(row),
            }
        )
    return entries


def parse_roleinfo_rows(text: str) -> list[dict]:
    entries = []
    for row in iter_all_csv_rows(text):
        if len(row) < 5:
            continue
        entries.append(
            {
                "name": row[0],
                "roleId": parse_int(row[1]),
                "roleClassField": parse_int(row[2]),
                "roleGroupField": parse_int(row[3]),
                "field4": parse_int(row[4]),
                "coreFields": parse_numbers(row[5:14]),
                "statFields": parse_numbers(row[14:45]),
                "tailFields": parse_numbers(row[45:-1]),
                "description": row[-1],
                "rawColumnCount": len(row),
            }
        )
    return entries


def parse_shop_rows(archive_manifest: dict, roleinfo_entries: list[dict]) -> list[dict]:
    role_names_by_id = {
        entry["roleId"]: entry["name"]
        for entry in roleinfo_entries
        if isinstance(entry.get("roleId"), int) and isinstance(entry.get("name"), str) and entry["name"]
    }
    latest_by_npc_id: dict[int, dict] = {}

    for entry in archive_manifest.get("entries", []):
        archive_name = entry.get("name")
        output_path = entry.get("outputPath")
        if not isinstance(archive_name, str) or not archive_name.endswith(".shop"):
            continue
        if not isinstance(output_path, str):
            continue
        match = __import__("re").match(r"^([0-9a-fA-F]+)__(\d+)\.shop$", output_path)
        if not match:
            continue
        archive_order = int(match.group(1), 16)
        npc_id = int(match.group(2), 10)
        existing = latest_by_npc_id.get(npc_id)
        if existing and existing["archiveOrderHex"] is not None and int(existing["archiveOrderHex"], 16) > archive_order:
            continue

        extracted_path = ARCHIVE_ROOT / output_path
        text = decode_client_text(extracted_path.read_bytes())
        items = parse_single_shop_file(text)
        if not items:
            continue
        latest_by_npc_id[npc_id] = {
            "npcId": npc_id,
            "speaker": role_names_by_id.get(npc_id, f"NPC {npc_id}"),
            "archiveEntry": archive_name,
            "extractedFile": str(extracted_path),
            "archiveOrderHex": match.group(1).lower(),
            "items": items,
        }

    return [latest_by_npc_id[npc_id] for npc_id in sorted(latest_by_npc_id)]


def parse_single_shop_file(text: str) -> list[dict]:
    entries = []
    for row in iter_all_csv_rows(text):
        if len(row) < 3:
            continue
        template_id = parse_int(row[0])
        gold_price = parse_int(row[1])
        coin_price = parse_int(row[2])
        if not isinstance(template_id, int) or template_id <= 0:
            continue
        entries.append(
            {
                "templateId": template_id,
                "goldPrice": gold_price if isinstance(gold_price, int) and gold_price > 0 else None,
                "coinPrice": coin_price if isinstance(coin_price, int) and coin_price > 0 else None,
                "quantity": 1,
            }
        )
    return entries


def iter_csv_rows(text: str) -> Iterable[list[str]]:
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return []

    reader = csv.reader(lines)
    next(reader, None)
    for row in reader:
        if not row:
            continue
        normalized = [column.strip() for column in row]
        while normalized and normalized[-1] == "":
            normalized.pop()
        if not normalized:
            continue
        first = normalized[0]
        if not first or not first.lstrip("-").isdigit():
            continue
        yield normalized


def iter_all_csv_rows(text: str) -> Iterable[list[str]]:
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return []

    reader = csv.reader(lines)
    next(reader, None)
    for row in reader:
        if not row:
            continue
        normalized = [column.strip() for column in row]
        while normalized and normalized[-1] == "":
            normalized.pop()
        if not normalized:
            continue
        yield normalized


def parse_int(value: str) -> int | None:
    stripped = value.strip()
    if not stripped or not stripped.lstrip("-").isdigit():
        return None
    return int(stripped, 10)


def parse_ints(values: Iterable[str]) -> list[int | None]:
    return [parse_int(value) for value in values]


def parse_number(value: str) -> int | float | None:
    stripped = value.strip()
    if not stripped:
        return None
    if stripped.lstrip("-").isdigit():
        return int(stripped, 10)
    try:
        return float(stripped)
    except ValueError:
        return None


def parse_numbers(values: Iterable[str]) -> list[int | float | None]:
    return [parse_number(value) for value in values]


def write_json(path: Path, payload: dict) -> None:
    if isinstance(payload.get("entries"), list):
        payload["count"] = len(payload["entries"])
    path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")


if __name__ == "__main__":
    main()
