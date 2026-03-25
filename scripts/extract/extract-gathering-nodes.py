#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ROLEINFO_DEFAULT = Path('data/client-derived/archive/0000136e__roleinfo.txt')
VERIFIED_DEFAULT = Path('data/client-verified/gathering-nodes.json')
OUTPUT_DEFAULT = Path('data/client-derived/gathering-nodes.json')

ROLEINFO_NODE_RE = re.compile(r'^"(?P<name>[^"]+)",(?P<template>\d+),(?P<type>\d+),(?P<unk>\d+),(?P<level>\d+),(?P<tool>\d+),(?P<unk2>\d+),(?P<drop>\d+),')
SCRIPT_CALL_RE = re.compile(r'macro_AddMapNpc\((?P<args>[^)]*)\)', re.IGNORECASE)
NUMBER_RE = re.compile(r'-?\d+')


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Extract gathering node metadata and placements.')
    parser.add_argument('--script', type=Path, help='Path to script.gcg')
    parser.add_argument('--roleinfo', type=Path, default=ROLEINFO_DEFAULT)
    parser.add_argument('--verified', type=Path, default=VERIFIED_DEFAULT)
    parser.add_argument('--output', type=Path, default=OUTPUT_DEFAULT)
    return parser.parse_args()


def parse_roleinfo(roleinfo_path: Path) -> list[dict[str, int | str]]:
    materials: list[dict[str, int | str]] = []
    if not roleinfo_path.exists():
        raise FileNotFoundError(f'missing roleinfo file: {roleinfo_path}')

    for line in roleinfo_path.read_text(encoding='utf8', errors='ignore').splitlines():
        match = ROLEINFO_NODE_RE.match(line.strip())
        if not match:
            continue
        if int(match.group('type')) != 8:
            continue
        node_template_id = int(match.group('template'))
        if node_template_id < 10001 or node_template_id > 10099:
            continue
        materials.append({
            'nodeTemplateId': node_template_id,
            'name': match.group('name'),
            'level': int(match.group('level')),
            'toolType': int(match.group('tool')),
            'dropItemId': int(match.group('drop')),
        })

    return sorted(materials, key=lambda entry: int(entry['nodeTemplateId']))


def parse_script_map_nodes(script_path: Path) -> list[dict[str, int]]:
    if not script_path.exists():
        return []

    current_map_id: int | None = None
    map_nodes: list[dict[str, int]] = []
    for raw_line in script_path.read_text(encoding='latin1', errors='ignore').splitlines():
        line = raw_line.strip()
        if not line:
            continue

        map_match = re.search(r'\b(?:mapid|map_id|curmap|sceneid)\s*=?\s*(\d+)\b', line, re.IGNORECASE)
        if map_match:
            current_map_id = int(map_match.group(1))

        call_match = SCRIPT_CALL_RE.search(line)
        if not call_match:
            continue

        numbers = [int(value) for value in NUMBER_RE.findall(call_match.group('args'))]
        if len(numbers) < 3:
            continue

        node_template_id = numbers[0]
        if node_template_id < 10001 or node_template_id > 10099:
            continue

        map_id = current_map_id
        x = 0
        y = 0

        if len(numbers) >= 4 and current_map_id is None:
            map_id = numbers[1]
            x = numbers[2]
            y = numbers[3]
        else:
            x = numbers[-2]
            y = numbers[-1]

        if map_id is None:
            continue

        map_nodes.append({
            'mapId': map_id,
            'nodeTemplateId': node_template_id,
            'x': x,
            'y': y,
        })

    return map_nodes


def parse_verified_map_nodes(verified_path: Path) -> list[dict[str, int]]:
    if not verified_path.exists():
        return []

    payload = json.loads(verified_path.read_text(encoding='utf8'))
    result: list[dict[str, int]] = []
    for map_entry in payload.get('maps', []):
        map_id = int(map_entry.get('mapId', 0))
        if map_id <= 0:
            continue
        for node in map_entry.get('nodes', []):
            node_template_id = int(node.get('nodeTemplateId', node.get('nodeId', 0)))
            x = int(node.get('x', 0))
            y = int(node.get('y', 0))
            if node_template_id <= 0:
                continue
            result.append({
                'mapId': map_id,
                'nodeTemplateId': node_template_id,
                'x': x,
                'y': y,
            })
    return result


def main() -> int:
    args = parse_args()
    materials = parse_roleinfo(args.roleinfo)
    map_nodes = parse_script_map_nodes(args.script) if args.script else []
    if not map_nodes:
        map_nodes = parse_verified_map_nodes(args.verified)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(
            {
                'materials': materials,
                'mapNodes': sorted(
                    map_nodes,
                    key=lambda entry: (entry['mapId'], entry['nodeTemplateId'], entry['x'], entry['y']),
                ),
            },
            indent=2,
        ) + '\n',
        encoding='utf8',
    )
    print(f'wrote {args.output}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
