#!/usr/bin/env python3
"""Summarize which shop variants can be safely mapped to maps with current extracted data."""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_ROOT = REPO_ROOT / "data" / "client-derived" / "archive"
MAPS_ROOT = REPO_ROOT / "data" / "client-derived" / "maps"
OUTPUT_FILE = REPO_ROOT / "data" / "client-derived" / "shop-map-binding-report.json"


def main() -> None:
    item_names = load_item_names()
    npc_occurrences = load_npc_occurrences()
    variants_by_npc_id = load_shop_variants(item_names)

    report_rows = []
    for npc_id in sorted(variants_by_npc_id):
      occurrences = npc_occurrences.get(npc_id, [])
      variants = variants_by_npc_id[npc_id]
      unique_map_ids = sorted({entry["mapId"] for entry in occurrences})
      status = classify_binding_status(unique_map_ids, variants)
      report_rows.append(
          {
              "npcId": npc_id,
              "maps": occurrences,
              "uniqueMapIds": unique_map_ids,
              "variantCount": len(variants),
              "status": status,
              "variants": variants,
          }
      )

    summary = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "npcIdsWithShopVariants": len(report_rows),
        "safeNpcIdOnlyBindings": sum(1 for row in report_rows if row["status"] == "safe-npcid-only"),
        "safeIdenticalVariantBindings": sum(1 for row in report_rows if row["status"] == "safe-identical-variants"),
        "ambiguousBindings": sum(1 for row in report_rows if row["status"] == "ambiguous"),
    }
    OUTPUT_FILE.write_text(json.dumps({"summary": summary, "rows": report_rows}, indent=2) + "\n", encoding="utf-8")
    print(OUTPUT_FILE)
    print(json.dumps(summary, indent=2))


def load_item_names() -> dict[int, str]:
    item_names: dict[int, str] = {}
    for name in ["items.json", "potions.json", "stuff.json", "equipment.json", "weapons.json"]:
        path = REPO_ROOT / "data" / "client-derived" / name
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for entry in payload.get("entries", []):
            template_id = entry.get("templateId")
            item_name = entry.get("name")
            if isinstance(template_id, int) and isinstance(item_name, str) and item_name:
                item_names[template_id] = item_name
    return item_names


def load_npc_occurrences() -> dict[int, list[dict[str, object]]]:
    results: dict[int, list[dict[str, object]]] = defaultdict(list)
    for path in sorted(MAPS_ROOT.glob("*.npcs.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        map_id = payload.get("mapId")
        if not isinstance(map_id, int):
            continue
        for index, npc in enumerate(payload.get("npcs", []), start=1):
            npc_id = npc.get("npcId")
            if not isinstance(npc_id, int):
                continue
            results[npc_id].append(
                {
                    "mapId": map_id,
                    "mapFile": path.name,
                    "slot": index,
                    "name": npc.get("name") or "",
                    "x": npc.get("x"),
                    "y": npc.get("y"),
                }
            )
    deduped_results: dict[int, list[dict[str, object]]] = {}
    for npc_id, occurrences in results.items():
        seen: set[tuple[object, ...]] = set()
        deduped_rows = []
        for entry in occurrences:
            key = (entry["mapId"], entry["slot"], entry["name"], entry["x"], entry["y"])
            if key in seen:
                continue
            seen.add(key)
            deduped_rows.append(entry)
        deduped_results[npc_id] = sorted(deduped_rows, key=lambda row: (int(row["mapId"]), int(row["slot"])))
    return deduped_results


def load_shop_variants(item_names: dict[int, str]) -> dict[int, list[dict[str, object]]]:
    grouped_paths: dict[int, list[Path]] = defaultdict(list)
    for path in sorted(ARCHIVE_ROOT.glob("*.shop")):
        match = re.search(r"__(\d+)\.shop$", path.name)
        if not match:
            continue
        grouped_paths[int(match.group(1))].append(path)

    results: dict[int, list[dict[str, object]]] = {}
    for npc_id, paths in sorted(grouped_paths.items()):
        variants_by_hash: dict[str, dict[str, object]] = {}
        for path in paths:
            items = parse_shop_items(path)
            if not items:
                continue
            canonical = json.dumps(items, sort_keys=True, separators=(",", ":")).encode("utf-8")
            variant_hash = hashlib.sha1(canonical).hexdigest()[:12]
            sample_items = []
            for item in items[:8]:
                template_id = item["templateId"]
                sample_items.append(
                    {
                        "templateId": template_id,
                        "name": item_names.get(template_id, f"Item {template_id}"),
                        "price": item["price"],
                    }
                )
            entry = variants_by_hash.get(variant_hash)
            if entry is None:
                variants_by_hash[variant_hash] = {
                    "variantHash": variant_hash,
                    "fileNames": [path.name],
                    "itemCount": len(items),
                    "sampleItems": sample_items,
                    "shopKindHints": infer_shop_kind_hints(sample_items),
                }
            else:
                entry["fileNames"].append(path.name)
        results[npc_id] = sorted(
            variants_by_hash.values(),
            key=lambda row: (row["itemCount"], row["variantHash"]),
        )
    return results


def parse_shop_items(path: Path) -> list[dict[str, int]]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except Exception:
        return []
    items: list[dict[str, int]] = []
    for line in lines[1:]:
        columns = [column.strip() for column in split_csv_columns(line)]
        if len(columns) < 3:
            continue
        try:
            template_id = int(columns[0])
        except Exception:
            continue
        price = parse_positive_int(columns[2])
        if price <= 0:
            price = parse_positive_int(columns[1])
        if template_id <= 0 or price <= 0:
            continue
        items.append({"templateId": template_id, "price": price})
    return items


def split_csv_columns(line: str) -> list[str]:
    columns: list[str] = []
    current = []
    in_quotes = False
    index = 0
    while index < len(line):
        char = line[index]
        if char == '"':
            if in_quotes and index + 1 < len(line) and line[index + 1] == '"':
                current.append('"')
                index += 2
                continue
            in_quotes = not in_quotes
            index += 1
            continue
        if char == "," and not in_quotes:
            columns.append("".join(current))
            current = []
            index += 1
            continue
        current.append(char)
        index += 1
    columns.append("".join(current))
    return columns


def parse_positive_int(raw: str) -> int:
    try:
        value = int(raw.strip())
    except Exception:
        return 0
    return value if value > 0 else 0


def infer_shop_kind_hints(sample_items: list[dict[str, object]]) -> list[str]:
    hints: set[str] = set()
    names = " ".join(str(item.get("name") or "").lower() for item in sample_items)
    template_ids = [int(item["templateId"]) for item in sample_items if isinstance(item.get("templateId"), int)]
    if any(5000 <= template_id < 6000 for template_id in template_ids):
        hints.add("weapon")
    if any(10000 <= template_id < 20000 for template_id in template_ids):
        hints.add("equipment")
    if any(29000 <= template_id < 30000 for template_id in template_ids):
        hints.add("medicine")
    if any(23000 <= template_id < 24000 for template_id in template_ids):
        hints.add("materials")
    if any(word in names for word in ["wine", "noodle", "pork", "tofu", "crayfish", "cookies"]):
        hints.add("food")
    if "pet " in names or "unsavory food" in names:
        hints.add("pet")
    return sorted(hints)


def classify_binding_status(unique_map_ids: list[int], variants: list[dict[str, object]]) -> str:
    if len(unique_map_ids) <= 1:
        return "safe-npcid-only"
    if len(variants) <= 1:
        return "safe-identical-variants"
    return "ambiguous"


if __name__ == "__main__":
    main()
