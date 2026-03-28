#!/usr/bin/env python3
"""Extract map overlay details from Zodiac Online client map script blocks."""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path, PureWindowsPath


DEFAULT_SCRIPT_GCG = Path("/home/nikon/Data/Zodiac Online/gcg/script.gcg")
DEFAULT_MAP_GCG = Path("/home/nikon/Data/Zodiac Online/gcg/map.gcg")
DEFAULT_MAPINFO = Path("data/client-derived/archive/00000cb1__mapinfo.txt")
DEFAULT_OUTPUT_DIR = Path("data/client-derived/maps")
DEFAULT_RUNTIME_TRIGGER_TRACE = Path("data/runtime/trigger-trace.jsonl")
DEFAULT_CLIENT_TRIGGER_TRACE = Path("data/runtime/client-server-run-trace.jsonl")

SET_BIG_TEXT_RE = re.compile(
    r'macro_SetBigText\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+))?\s*\)'
)
SET_HOME_INFO_RE = re.compile(r"macro_SetHomeInfo\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)")
ADD_TMP_PT_RE = re.compile(r"macro_AddMapTmpPt\(\s*(\d+)\s*,\s*(\d+)\s*\)")
ROUND_CHANGE_SCENE_RE = re.compile(
    r"macro_RoleCheckRound\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)"
    r"\s*if\s*\(\s*iResult\s*==\s*1\s*\)\s*then\s*"
    r"macro_ChangeScene\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)",
    re.DOTALL,
)
MAP_GAF_BLOCK_RE_TEMPLATE = r"smallmap=\\PicData\\smallmap\\{map_id}\.gaf"
MAP_CONFIG_NPC_RE = re.compile(r"^(\d+),(\d+),(\d+),(\d+)$")
MAP_EFFECT_RE = re.compile(
    r"^(PicData\\Effect\\scene\\[^,]+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),?$",
    re.IGNORECASE,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract map overlay labels and temporary map points from client script.gcg."
    )
    parser.add_argument("--map-name", help="Exact map name from mapinfo.txt")
    parser.add_argument("--all", action="store_true", help="Extract all maps that have map detail data")
    parser.add_argument("--script-gcg", type=Path, default=DEFAULT_SCRIPT_GCG)
    parser.add_argument("--map-gcg", type=Path, default=DEFAULT_MAP_GCG)
    parser.add_argument("--mapinfo", type=Path, default=DEFAULT_MAPINFO)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--runtime-trigger-trace", type=Path, default=DEFAULT_RUNTIME_TRIGGER_TRACE)
    parser.add_argument("--client-trigger-trace", type=Path, default=DEFAULT_CLIENT_TRIGGER_TRACE)
    args = parser.parse_args()
    if bool(args.map_name) == bool(args.all):
        parser.error("provide exactly one of --map-name or --all")
    return args


def load_map_ids(path: Path) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for raw_line in path.read_text(encoding="latin1").splitlines():
        line = raw_line.strip()
        if not line or "," not in line or line.startswith("goldcool"):
            continue
        try:
            map_id_text, map_name = next(csv.reader([line]))
        except Exception:
            continue
        if map_id_text.isdigit():
            mapping[map_name] = int(map_id_text)
    return mapping


def find_map_chunk(script_text: str, map_name: str) -> tuple[str, int, int]:
    anchor_patterns = [
        re.compile(rf'macro_SetBigText\("¡ï\s*{re.escape(map_name)}\s*¡ï"'),
        re.compile(rf'macro_SetBigText\("��\s*{re.escape(map_name)}\s*��"'),
    ]
    anchor_index = -1
    for pattern in anchor_patterns:
        match = pattern.search(script_text)
        if match is None:
            continue
        anchor_index = match.start()
        break
    if anchor_index == -1:
        raise ValueError(f"could not find map anchor for {map_name!r}")

    block_start = script_text.rfind("macro_ClearBigText()", 0, anchor_index)
    if block_start == -1:
        raise ValueError(f"could not find macro_ClearBigText() before {map_name!r}")

    next_block_start = script_text.find("macro_ClearBigText()", anchor_index + 1)
    if next_block_start == -1:
        next_block_start = len(script_text)

    chunk = script_text[block_start:next_block_start]
    return chunk, block_start, next_block_start


def decode_client_text(value: str) -> str:
    return value.replace('\\"', '"').replace("\\\\", "\\")


def extract_big_texts(chunk: str, map_name: str) -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    for order, match in enumerate(SET_BIG_TEXT_RE.finditer(chunk)):
        text = decode_client_text(match.group(1))
        duration_ms = int(match.group(2))
        color = int(match.group(3))
        delay_ms = int(match.group(4)) if match.group(4) is not None else 0
        results.append(
            {
                "order": order,
                "text": text,
                "durationMs": duration_ms,
                "color": color,
                "delayMs": delay_ms,
                "kind": "map-title" if map_name in text else "overlay-label",
                "rawCall": match.group(0),
            }
        )
    return results


def extract_home_info(chunk: str) -> dict[str, int] | None:
    match = SET_HOME_INFO_RE.search(chunk)
    if match is None:
        return None
    return {
        "mapId": int(match.group(1)),
        "x": int(match.group(2)),
        "y": int(match.group(3)),
    }


def extract_tmp_points(chunk: str) -> list[dict[str, int]]:
    return [
        {"order": order, "x": int(match.group(1)), "y": int(match.group(2))}
        for order, match in enumerate(ADD_TMP_PT_RE.finditer(chunk))
    ]


def extract_scene_transitions(text: str, map_ids: dict[str, int]) -> list[dict[str, object]]:
    map_names_by_id = {map_id: name for name, map_id in map_ids.items()}
    transitions: list[dict[str, object]] = []
    for order, match in enumerate(ROUND_CHANGE_SCENE_RE.finditer(text)):
        source_mode = int(match.group(1))
        trigger_x = int(match.group(2))
        trigger_y = int(match.group(3))
        trigger_radius = int(match.group(4))
        target_map_id = int(match.group(5))
        target_x = int(match.group(6))
        target_y = int(match.group(7))
        transitions.append(
            {
                "order": order,
                "trigger": {
                    "kind": "role-check-round",
                    "mode": source_mode,
                    "x": trigger_x,
                    "y": trigger_y,
                    "radius": trigger_radius,
                },
                "target": {
                    "mapId": target_map_id,
                    "mapName": map_names_by_id.get(target_map_id),
                    "x": target_x,
                    "y": target_y,
                },
                "rawCheckCall": match.group(0).split("if", 1)[0].strip(),
                "rawChangeSceneCall": (
                    f"macro_ChangeScene({target_map_id},{target_x},{target_y})"
                ),
            }
        )
    return transitions


def find_map_config_chunk(map_text: str, map_id: int) -> tuple[str, int, int] | None:
    anchor_re = re.compile(MAP_GAF_BLOCK_RE_TEMPLATE.format(map_id=map_id))
    match = anchor_re.search(map_text)
    if match is None:
        return None

    block_start = map_text.rfind("[cfg]", 0, match.start())
    if block_start == -1:
        return None

    next_block_start = map_text.find("[cfg]", match.end())
    if next_block_start == -1:
        next_block_start = len(map_text)

    return map_text[block_start:next_block_start], block_start, next_block_start


def find_map_config_prelude_lines(map_text: str, chunk_start: int, max_lines: int = 64) -> list[str]:
    prefix = map_text[:chunk_start].splitlines()
    if not prefix:
        return []
    candidate_lines = [line.strip() for line in prefix[-max_lines:] if line.strip()]
    return [line for line in candidate_lines if MAP_EFFECT_RE.match(line)]


def load_observed_trigger_points(
    runtime_trace_path: Path,
    client_trace_path: Path,
    map_id: int,
) -> list[dict[str, int | str]]:
    points: list[dict[str, int | str]] = []

    if runtime_trace_path.exists():
        for raw_line in runtime_trace_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            raw_line = raw_line.strip()
            if not raw_line:
                continue
            try:
                event = json.loads(raw_line)
            except json.JSONDecodeError:
                continue
            if event.get("kind") != "server-run":
                continue
            if int(event.get("mapId") or 0) != map_id:
                continue
            if int(event.get("subcmd") or 0) != 1:
                continue
            x = event.get("x")
            y = event.get("y")
            if x is None or y is None:
                continue
            points.append({"source": "runtime-trace", "x": int(x), "y": int(y)})

    if client_trace_path.exists():
        for raw_line in client_trace_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            raw_line = raw_line.strip()
            if not raw_line:
                continue
            try:
                event = json.loads(raw_line)
            except json.JSONDecodeError:
                continue
            if int(event.get("mapId") or 0) != map_id:
                continue
            if int(event.get("subcmd") or 0) != 1:
                continue
            x = event.get("x")
            y = event.get("y")
            if x is None or y is None:
                continue
            points.append({"source": "client-probe", "x": int(x), "y": int(y)})

    unique: dict[tuple[int, int, str], dict[str, int | str]] = {}
    for point in points:
        unique[(int(point["x"]), int(point["y"]), str(point["source"]))] = point
    return list(unique.values())


def build_effect_record(effect_match: re.Match[str], source: str) -> dict[str, object]:
    effect_path = effect_match.group(1)
    return {
        "assetPath": effect_path,
        "assetName": PureWindowsPath(effect_path).name,
        "x": int(effect_match.group(2)),
        "y": int(effect_match.group(3)),
        "arg3": int(effect_match.group(4)),
        "arg4": int(effect_match.group(5)),
        "arg5": int(effect_match.group(6)),
        "source": source,
    }


def extract_map_config_details(
    chunk: str,
    map_id: int,
    transitions: list[dict[str, object]],
    prelude_lines: list[str],
    observed_trigger_points: list[dict[str, int | str]],
) -> dict[str, object] | None:
    lines = [line.strip() for line in chunk.splitlines() if line.strip()]

    smallmap_path = next(
        (line.split("=", 1)[1] for line in lines if line.lower().startswith("smallmap=")),
        None,
    )
    filename = next(
        (line.split("=", 1)[1] for line in lines if line.lower().startswith("filename=")),
        None,
    )

    npcs: list[dict[str, int]] = []
    effects: list[dict[str, object]] = []
    portal_candidates: list[dict[str, object]] = []

    for line in lines:
        npc_match = MAP_CONFIG_NPC_RE.match(line)
        if npc_match:
            npcs.append(
                {
                    "order": int(npc_match.group(1)),
                    "npcId": int(npc_match.group(2)),
                    "x": int(npc_match.group(3)),
                    "y": int(npc_match.group(4)),
                }
            )
            continue

        effect_match = MAP_EFFECT_RE.match(line)
        if effect_match:
            effects.append(build_effect_record(effect_match, "map-config"))

    for line in prelude_lines:
        effect_match = MAP_EFFECT_RE.match(line)
        if effect_match:
            effects.append(build_effect_record(effect_match, "prelude"))

    for effect in effects:
        if effect["assetName"].lower() != "sina.gaf":
            continue

        nearest_transition = None
        nearest_transition_distance_sq = None
        for transition in transitions:
            trigger = transition["trigger"]
            dx = int(effect["x"]) - int(trigger["x"])
            dy = int(effect["y"]) - int(trigger["y"])
            distance_sq = dx * dx + dy * dy
            if nearest_transition_distance_sq is None or distance_sq < nearest_transition_distance_sq:
                nearest_transition_distance_sq = distance_sq
                nearest_transition = transition

        nearest_observed = None
        nearest_observed_distance_sq = None
        for point in observed_trigger_points:
            dx = int(effect["x"]) - int(point["x"])
            dy = int(effect["y"]) - int(point["y"])
            distance_sq = dx * dx + dy * dy
            if nearest_observed_distance_sq is None or distance_sq < nearest_observed_distance_sq:
                nearest_observed_distance_sq = distance_sq
                nearest_observed = point

        portal_candidates.append(
            {
                **effect,
                "kind": "portal-effect-candidate",
                "nearestTransition": (
                    {
                        "order": nearest_transition["order"],
                        "trigger": nearest_transition["trigger"],
                        "target": nearest_transition["target"],
                        "distanceSquared": nearest_transition_distance_sq,
                    }
                    if nearest_transition is not None
                    else None
                ),
                "nearestObservedTrigger": (
                    {
                        **nearest_observed,
                        "distanceSquared": nearest_observed_distance_sq,
                    }
                    if nearest_observed is not None
                    else None
                ),
            }
        )

    return {
        "smallMapAsset": smallmap_path,
        "backgroundAsset": filename,
        "mapConfigNpcSpawns": npcs,
        "sceneEffects": effects,
        "portalEffectCandidates": portal_candidates,
        "observedTriggerPoints": observed_trigger_points,
    }


def slugify_map_name(map_name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", map_name.lower()).strip("-")
    return slug or "map"


def build_output_stem(map_id: int, map_name: str) -> str:
    return f"{map_id:03d}-{slugify_map_name(map_name)}"


def build_output(
    map_name: str,
    map_id: int,
    script_gcg: Path,
    map_gcg: Path,
    mapinfo: Path,
    runtime_trigger_trace: Path,
    client_trigger_trace: Path,
    script_text: str,
    map_text: str,
    map_ids: dict[str, int],
) -> dict[str, object]:
    chunk, start_offset, end_offset = find_map_chunk(script_text, map_name)
    transition_context = script_text[max(0, start_offset - 512):end_offset]
    transitions = extract_scene_transitions(transition_context, map_ids)
    map_config_chunk = find_map_config_chunk(map_text, map_id)
    observed_trigger_points = load_observed_trigger_points(
        runtime_trigger_trace,
        client_trigger_trace,
        map_id,
    )
    map_config_prelude_lines = (
        find_map_config_prelude_lines(map_text, map_config_chunk[1])
        if map_config_chunk is not None
        else []
    )

    return {
        "mapId": map_id,
        "mapName": map_name,
        "source": {
            "scriptGcg": str(script_gcg),
            "mapGcg": str(map_gcg),
            "mapinfo": str(mapinfo),
            "chunkOffsets": {
                "start": start_offset,
                "end": end_offset,
            },
            "transitionContextStart": max(0, start_offset - 512),
            "mapConfigChunkOffsets": (
                {
                    "start": map_config_chunk[1],
                    "end": map_config_chunk[2],
                }
                if map_config_chunk is not None
                else None
            ),
        },
        "bigTexts": extract_big_texts(chunk, map_name),
        "homeInfo": extract_home_info(chunk),
        "temporaryMapPoints": extract_tmp_points(chunk),
        "sceneTransitions": transitions,
        "mapConfig": (
            extract_map_config_details(
                map_config_chunk[0],
                map_id,
                transitions,
                map_config_prelude_lines,
                observed_trigger_points,
            )
            if map_config_chunk is not None
            else None
        ),
    }


def main() -> None:
    args = parse_args()
    map_ids = load_map_ids(args.mapinfo)
    script_text = args.script_gcg.read_text(encoding="latin1", errors="ignore")
    map_text = args.map_gcg.read_text(encoding="latin1", errors="ignore")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    if args.all:
        extracted = 0
        skipped: list[dict[str, object]] = []
        for map_name, map_id in sorted(map_ids.items(), key=lambda item: item[1]):
            try:
                output = build_output(
                    map_name,
                    map_id,
                    args.script_gcg,
                    args.map_gcg,
                    args.mapinfo,
                    args.runtime_trigger_trace,
                    args.client_trigger_trace,
                    script_text,
                    map_text,
                    map_ids,
                )
            except Exception as exc:
                skipped.append({"mapId": map_id, "mapName": map_name, "reason": str(exc)})
                continue

            output_path = args.output_dir / f"{build_output_stem(map_id, map_name)}.map-details.json"
            output_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
            extracted += 1

        manifest = {
            "kind": "map-details-bulk-extract",
            "source": {
                "scriptGcg": str(args.script_gcg),
                "mapGcg": str(args.map_gcg),
                "mapinfo": str(args.mapinfo),
            },
            "summary": {
                "mapsInMapInfo": len(map_ids),
                "mapsExtracted": extracted,
                "mapsSkipped": len(skipped),
            },
            "skipped": skipped,
        }
        manifest_path = args.output_dir / "map-details.index.json"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(manifest_path)
        print(extracted)
        print(len(skipped))
        return

    if args.map_name not in map_ids:
        raise SystemExit(f"map name not found in {args.mapinfo}: {args.map_name}")

    output = build_output(
        args.map_name,
        map_ids[args.map_name],
        args.script_gcg,
        args.map_gcg,
        args.mapinfo,
        args.runtime_trigger_trace,
        args.client_trigger_trace,
        script_text,
        map_text,
        map_ids,
    )
    output_path = args.output_dir / f"{build_output_stem(map_ids[args.map_name], args.map_name)}.map-details.json"
    output_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(output_path)
    print(len(output["bigTexts"]))
    print(len(output["temporaryMapPoints"]))
    print(len(output["sceneTransitions"]))
    print(
        len(output["mapConfig"]["portalEffectCandidates"])
        if output["mapConfig"] is not None
        else 0
    )


if __name__ == "__main__":
    main()
