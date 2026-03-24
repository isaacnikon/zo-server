#!/usr/bin/env python3
"""Dump live Zodiac Online MAINMAP widget state via gdb.

This snapshots the custom `mainMap` widget and its loaded small-map resource
subobjects from the running `gc12.exe` process. It avoids interactive
breakpoints and writes a JSON file for offline inspection.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


DEFAULT_PID = 97193
DEFAULT_OUTPUT = Path("data/client-derived/maps/live-mainmap-state.json")

MAINMAP_WIDGET_ADDR = 0x006485CC


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Dump live MAINMAP widget state from gc12.exe.")
    parser.add_argument("--pid", type=int, default=DEFAULT_PID, help="PID of gc12.exe")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Where to write the JSON snapshot",
    )
    parser.add_argument(
        "--widget-addr",
        type=lambda text: int(text, 0),
        default=MAINMAP_WIDGET_ADDR,
        help="Address of the static mainMap widget object",
    )
    return parser.parse_args()


def run_gdb(pid: int, commands: list[str]) -> str:
    cmd = ["gdb", "-q", "-p", str(pid), "-batch", "-ex", "set pagination off"]
    for command in commands:
        cmd.extend(["-ex", command])
    cmd.extend(["-ex", "detach", "-ex", "quit"])
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return result.stdout


def read_words(pid: int, address: int, count: int) -> list[int]:
    output = run_gdb(pid, [f"x/{count}wx 0x{address:08x}"])
    words: list[int] = []
    for line in output.splitlines():
        if ":" not in line:
            continue
        _, rhs = line.split(":", 1)
        for token in rhs.strip().split():
            if token.startswith("0x"):
                words.append(int(token, 16))
    return words


def read_bytes(pid: int, address: int, count: int) -> list[int]:
    output = run_gdb(pid, [f"x/{count}bx 0x{address:08x}"])
    values: list[int] = []
    for line in output.splitlines():
        if ":" not in line:
            continue
        _, rhs = line.split(":", 1)
        for token in rhs.strip().split():
            if token.startswith("0x"):
                values.append(int(token, 16))
    return values


def read_string(pid: int, address: int) -> str | None:
    if address == 0:
        return None
    output = run_gdb(pid, [f"x/s 0x{address:08x}"])
    for line in output.splitlines():
        if ":" not in line:
            continue
        _, rhs = line.split(":", 1)
        rhs = rhs.strip()
        if rhs.startswith('"') and rhs.endswith('"'):
            return rhs[1:-1]
    return None


def parse_c_string(data: list[int], offset: int) -> str:
    end = offset
    while end < len(data) and data[end] != 0:
        end += 1
    return bytes(data[offset:end]).decode("latin1", errors="replace")


def parse_point_vector(pid: int, vector_addr: int) -> list[dict[str, int]]:
    vector_words = read_words(pid, vector_addr, 4)
    if len(vector_words) < 4:
        return []

    start, end = vector_words[1], vector_words[2]
    if start == 0 or end < start:
        return []

    point_count = (end - start) // 4
    if point_count <= 0 or point_count > 4096:
        return []

    raw_points = read_words(pid, start, point_count)
    points: list[dict[str, int]] = []
    for raw in raw_points:
        x = raw & 0xFFFF
        y = (raw >> 16) & 0xFFFF
        if x & 0x8000:
            x -= 0x10000
        if y & 0x8000:
            y -= 0x10000
        points.append({"x": x, "y": y})
    return points


def dump_region_table(pid: int, map_object_addr: int) -> dict[str, object] | None:
    region_table_addr = read_words(pid, map_object_addr + 0x68, 1)[0]
    if region_table_addr == 0:
        return None

    header = read_words(pid, region_table_addr, 12)
    if len(header) < 12:
        return None

    groups_start = header[1]
    groups_end = header[2]
    group_count = 0
    if groups_start and groups_end >= groups_start:
        group_count = (groups_end - groups_start) // 0x10

    groups: list[dict[str, object]] = []
    for index in range(group_count):
        entry_addr = groups_start + index * 0x10
        entry_words = read_words(pid, entry_addr, 4)
        if len(entry_words) < 4:
            continue
        points = parse_point_vector(pid, entry_addr)
        xs = [point["x"] for point in points]
        ys = [point["y"] for point in points]
        groups.append(
            {
                "index": index,
                "entryAddress": f"0x{entry_addr:08x}",
                "pointCount": len(points),
                "bounds": {
                    "minX": min(xs) if xs else None,
                    "minY": min(ys) if ys else None,
                    "maxX": max(xs) if xs else None,
                    "maxY": max(ys) if ys else None,
                },
                "points": points,
                "rawWords": [f"0x{word:08x}" for word in entry_words],
            }
        )

    return {
        "address": f"0x{region_table_addr:08x}",
        "rawWords": [f"0x{word:08x}" for word in header],
        "enabled": header[4] & 0xFF,
        "modeByte": (header[4] >> 8) & 0xFF,
        "u16_12": (header[4] >> 16) & 0xFFFF,
        "u32_14": header[5],
        "u16_18": header[6] & 0xFFFF,
        "u16_1a": (header[6] >> 16) & 0xFFFF,
        "u16_1c": header[7] & 0xFFFF,
        "u16_1e": (header[7] >> 16) & 0xFFFF,
        "u16_20": header[8] & 0xFFFF,
        "u16_22": (header[8] >> 16) & 0xFFFF,
        "u8_28": header[10] & 0xFF,
        "maxGroupIndex": header[11],
        "groupCount": group_count,
        "groups": groups,
    }


def dump_subobjects(pid: int, map_object_addr: int) -> list[dict[str, object]]:
    head_addr = read_words(pid, map_object_addr + 0x4C, 1)[0]
    if head_addr == 0:
        return []

    head_words = read_words(pid, head_addr, 2)
    if len(head_words) < 2:
        return []

    nodes: list[dict[str, object]] = []
    seen: set[int] = set()
    current = head_words[0]
    index = 0

    while current != head_addr and current not in seen:
        seen.add(current)
        node_words = read_words(pid, current, 6)
        payload = node_words[2] if len(node_words) > 2 else 0
        payload_words = read_words(pid, payload, 32) if payload else []
        payload_bytes = read_bytes(pid, payload, 128) if payload else []
        nodes.append(
            {
                "index": index,
                "nodeAddress": f"0x{current:08x}",
                "next": f"0x{node_words[0]:08x}" if len(node_words) > 0 else None,
                "prev": f"0x{node_words[1]:08x}" if len(node_words) > 1 else None,
                "payloadAddress": f"0x{payload:08x}" if payload else None,
                "payloadWords": [f"0x{word:08x}" for word in payload_words],
                "payloadBytesHex": "".join(f"{byte:02x}" for byte in payload_bytes),
                "payloadAsciiPreview": parse_c_string(payload_bytes, 0) if payload_bytes else "",
                "payloadPointerString": read_string(pid, payload_words[1]) if len(payload_words) > 1 else None,
            }
        )
        current = node_words[0]
        index += 1

    return nodes


def main() -> None:
    args = parse_args()

    widget_words = read_words(args.pid, args.widget_addr, 48)
    if len(widget_words) < 48:
        raise SystemExit("failed to read mainMap widget words")

    map_object_addr = widget_words[11]
    snapshot = {
        "pid": args.pid,
        "widgetAddress": f"0x{args.widget_addr:08x}",
        "widget": {
            "rawWords": [f"0x{word:08x}" for word in widget_words],
            "mapObject": f"0x{map_object_addr:08x}" if map_object_addr else None,
            "overlayEntriesStart": f"0x{widget_words[8]:08x}" if widget_words[8] else None,
            "overlayEntriesEnd": f"0x{widget_words[9]:08x}" if widget_words[9] else None,
            "mode": widget_words[12],
            "drawEnabledWord": widget_words[0],
            "layoutWidth": widget_words[5],
            "layoutHeight": widget_words[6],
        },
    }

    if map_object_addr:
        map_words = read_words(args.pid, map_object_addr, 48)
        snapshot["mapObject"] = {
            "address": f"0x{map_object_addr:08x}",
            "rawWords": [f"0x{word:08x}" for word in map_words],
            "flags": map_words[22] if len(map_words) > 22 else None,
            "subobjectCount": (map_words[24] >> 16) & 0xFFFF if len(map_words) > 24 else None,
            "regionTable": dump_region_table(args.pid, map_object_addr),
            "subobjects": dump_subobjects(args.pid, map_object_addr),
        }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
