#!/usr/bin/env python3
"""Extract map NPC marker/list data from Zodiac Online client scripts."""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path


DEFAULT_SCRIPT_GCG = Path("/home/nikon/Data/Zodiac Online/gcg/script.gcg")
DEFAULT_ROLEINFO = Path("data/client-derived/archive/0000136e__roleinfo.txt")
DEFAULT_MAPINFO = Path("data/client-derived/archive/00000cb1__mapinfo.txt")
DEFAULT_OUTPUT_DIR = Path("data/client-derived/maps")

ADD_MAP_NPC_RE = re.compile(
    r'macro_AddMapNpc\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(.*?)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)'
)
TYPE_NAME_EXPR_RE = re.compile(r'macro_GetTypeNpcName\(\s*(\d+)\s*\)')


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract a map NPC JSON file from client script.gcg data."
    )
    parser.add_argument("--map-name", help="Exact map name from mapinfo.txt")
    parser.add_argument("--all", action="store_true", help="Extract all maps that have NPC data")
    parser.add_argument("--script-gcg", type=Path, default=DEFAULT_SCRIPT_GCG)
    parser.add_argument("--roleinfo", type=Path, default=DEFAULT_ROLEINFO)
    parser.add_argument("--mapinfo", type=Path, default=DEFAULT_MAPINFO)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args()
    if bool(args.map_name) == bool(args.all):
        parser.error("provide exactly one of --map-name or --all")
    return args


def load_map_ids(path: Path) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for raw_line in path.read_text(encoding="latin1").splitlines():
        line = raw_line.strip()
        if not line or "," not in line:
            continue
        if line.startswith("goldcool"):
            continue
        try:
            map_id_text, map_name = next(csv.reader([line]))
        except Exception:
            continue
        if not map_id_text.isdigit():
            continue
        mapping[map_name] = int(map_id_text)
    return mapping


def load_role_names(path: Path) -> dict[int, str]:
    role_names: dict[int, str] = {}
    for raw_line in path.read_text(encoding="latin1").splitlines():
        if not raw_line.strip():
            continue
        try:
            row = next(csv.reader([raw_line]))
        except Exception:
            continue
        if len(row) < 2 or not row[1].isdigit():
            continue
        role_names[int(row[1])] = row[0]
    return role_names


def load_role_ids_by_name(path: Path) -> dict[str, int]:
    role_ids: dict[str, int] = {}
    for raw_line in path.read_text(encoding="latin1").splitlines():
        if not raw_line.strip():
            continue
        try:
            row = next(csv.reader([raw_line]))
        except Exception:
            continue
        if len(row) < 2 or not row[1].isdigit():
            continue
        role_ids.setdefault(row[0], int(row[1]))
    return role_ids


def find_map_chunk(script_text: str, map_name: str) -> tuple[str, int, int]:
    anchor = f'macro_SetBigText("¡ï{map_name}¡ï"'
    anchor_index = script_text.find(anchor)
    if anchor_index == -1:
        anchor = f'macro_SetBigText("��{map_name}��"'
        anchor_index = script_text.find(anchor)
    if anchor_index == -1:
        raise ValueError(f"could not find map anchor for {map_name!r}")

    block_start = script_text.rfind("macro_ClearBigText()", 0, anchor_index)
    if block_start == -1:
        raise ValueError(f"could not find macro_ClearBigText() before {map_name!r}")

    chunk = script_text[block_start:anchor_index]
    return chunk, block_start, anchor_index


def resolve_name(name_expr: str, role_names: dict[int, str]) -> tuple[str, str]:
    literal = name_expr.strip()
    if literal.startswith('"') and literal.endswith('"') and ".." not in literal:
        return literal[1:-1], "literal"

    match = TYPE_NAME_EXPR_RE.search(name_expr)
    if match is not None:
        npc_id = int(match.group(1))
        return role_names.get(npc_id, f"<unknown:{npc_id}>"), "macro_GetTypeNpcName"

    return literal, "raw_expr"


def parse_npcs(
    chunk: str,
    role_names: dict[int, str],
    role_ids_by_name: dict[str, int],
) -> list[dict[str, object]]:
    npcs: list[dict[str, object]] = []
    for order, match in enumerate(ADD_MAP_NPC_RE.finditer(chunk)):
        npc_id = int(match.group(1))
        npc_type_id = int(match.group(2))
        name_expr = match.group(3)
        x = int(match.group(4))
        y = int(match.group(5))
        name, name_source = resolve_name(name_expr, role_names)
        roleinfo_name_by_npc_id = role_names.get(npc_id)
        roleinfo_id_by_name = role_ids_by_name.get(name)
        name_matches_roleinfo = roleinfo_name_by_npc_id == name if roleinfo_name_by_npc_id else False
        resolved_spawn_entity_type = (
            roleinfo_id_by_name
            if name_source == "literal" and isinstance(roleinfo_id_by_name, int)
            else npc_id
        )
        validation_status = "match"
        if roleinfo_name_by_npc_id is None:
            validation_status = "missing-roleinfo-id"
        elif name_source == "literal" and not name_matches_roleinfo:
            validation_status = "literal-name-mismatch"
        elif roleinfo_id_by_name is None:
            validation_status = "missing-roleinfo-name"
        elif roleinfo_id_by_name != npc_id:
            validation_status = "alias-id-mismatch"
        npcs.append(
            {
                "order": order,
                "npcId": npc_id,
                "npcTypeId": npc_type_id,
                "name": name,
                "nameSource": name_source,
                "x": x,
                "y": y,
                "roleinfoNameByNpcId": roleinfo_name_by_npc_id,
                "roleinfoIdByName": roleinfo_id_by_name,
                "nameMatchesRoleinfo": name_matches_roleinfo,
                "resolvedSpawnEntityType": resolved_spawn_entity_type,
                "validationStatus": validation_status,
                "rawCall": match.group(0),
            }
        )
    if not npcs:
        raise ValueError("no macro_AddMapNpc calls found in extracted chunk")
    return npcs


def slugify_map_name(map_name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", map_name.lower()).strip("-")
    return slug or "map"


def build_output_stem(map_id: int, map_name: str) -> str:
    return f"{map_id:03d}-{slugify_map_name(map_name)}"


def build_output(
    map_name: str,
    map_id: int,
    script_gcg: Path,
    roleinfo: Path,
    mapinfo: Path,
    chunk: str,
    start_offset: int,
    end_offset: int,
    role_names: dict[int, str],
    role_ids_by_name: dict[str, int],
) -> dict[str, object]:
    npcs = parse_npcs(chunk, role_names, role_ids_by_name)
    return {
        "mapId": map_id,
        "mapName": map_name,
        "source": {
            "scriptGcg": str(script_gcg),
            "roleinfo": str(roleinfo),
            "mapinfo": str(mapinfo),
            "chunkOffsets": {
                "start": start_offset,
                "end": end_offset,
            },
        },
        "validationSummary": {
            "totalNpcs": len(npcs),
            "statusCounts": {
                status: sum(1 for npc in npcs if npc["validationStatus"] == status)
                for status in sorted({str(npc["validationStatus"]) for npc in npcs})
            },
        },
        "npcs": npcs,
    }


def main() -> None:
    args = parse_args()

    map_ids = load_map_ids(args.mapinfo)
    role_names = load_role_names(args.roleinfo)
    role_ids_by_name = load_role_ids_by_name(args.roleinfo)
    script_text = args.script_gcg.read_text(encoding="latin1", errors="ignore")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    if args.all:
        extracted = 0
        skipped: list[dict[str, object]] = []
        for map_name, map_id in sorted(map_ids.items(), key=lambda item: item[1]):
            try:
                chunk, start_offset, end_offset = find_map_chunk(script_text, map_name)
                output = build_output(
                    map_name,
                    map_id,
                    args.script_gcg,
                    args.roleinfo,
                    args.mapinfo,
                    chunk,
                    start_offset,
                    end_offset,
                    role_names,
                    role_ids_by_name,
                )
            except Exception as exc:
                skipped.append({"mapId": map_id, "mapName": map_name, "reason": str(exc)})
                continue

            output_path = args.output_dir / f"{build_output_stem(map_id, map_name)}.npcs.json"
            output_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
            extracted += 1

        manifest = {
            "kind": "map-npc-bulk-extract",
            "source": {
                "scriptGcg": str(args.script_gcg),
                "roleinfo": str(args.roleinfo),
                "mapinfo": str(args.mapinfo),
            },
            "summary": {
                "mapsInMapInfo": len(map_ids),
                "mapsExtracted": extracted,
                "mapsSkipped": len(skipped),
            },
            "skipped": skipped,
        }
        manifest_path = args.output_dir / "map-npcs.index.json"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(manifest_path)
        print(extracted)
        print(len(skipped))
        return

    if args.map_name not in map_ids:
        raise SystemExit(f"map name not found in {args.mapinfo}: {args.map_name}")

    chunk, start_offset, end_offset = find_map_chunk(script_text, args.map_name)
    output = build_output(
        args.map_name,
        map_ids[args.map_name],
        args.script_gcg,
        args.roleinfo,
        args.mapinfo,
        chunk,
        start_offset,
        end_offset,
        role_names,
        role_ids_by_name,
    )
    output_path = args.output_dir / f"{build_output_stem(map_ids[args.map_name], args.map_name)}.npcs.json"
    output_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(output_path)
    print(len(output["npcs"]))


if __name__ == "__main__":
    main()
