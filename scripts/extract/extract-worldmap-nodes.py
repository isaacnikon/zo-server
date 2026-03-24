#!/usr/bin/env python3
"""Extract fixed world map node labels from Zodiac Online ui.gcg."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


DEFAULT_UI_GCG = Path("/home/nikon/Data/Zodiac Online/gcg/ui.gcg")
DEFAULT_OUTPUT = Path("data/client-derived/maps/worldmap-nodes.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract WORLDMAP worldsubnode controls and labels from client ui.gcg."
    )
    parser.add_argument("--ui-gcg", type=Path, default=DEFAULT_UI_GCG)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def parse_ui_file(lines: list[str]) -> list[dict[str, object]]:
    windows: list[dict[str, object]] = []
    current_window: dict[str, object] | None = None
    current_control: dict[str, object] | None = None

    def finish_control() -> None:
        nonlocal current_control
        if current_window is not None and current_control is not None:
            current_window["controls"].append(current_control)
        current_control = None

    def finish_window() -> None:
        nonlocal current_window
        finish_control()
        if current_window is not None:
            windows.append(current_window)
        current_window = None

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue

        if line == "[WININFO]":
            finish_window()
            current_window = {"window": {}, "controls": []}
            continue

        if line.startswith("[") and line.endswith("]") and line[1:-1].isdigit():
            finish_control()
            if current_window is None:
                continue
            current_control = {"index": int(line[1:-1])}
            continue

        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        if current_control is not None:
            current_control[key] = value
        elif current_window is not None:
            current_window["window"][key] = value

    finish_window()
    return windows


def as_int(control: dict[str, object], key: str) -> int | None:
    value = control.get(key)
    if value is None or value == "":
        return None
    try:
        return int(str(value))
    except ValueError:
        return None


def classify_node(control: dict[str, object]) -> str:
    hintlua = str(control.get("hintlua", ""))
    picfilename = str(control.get("picfilename", ""))
    if "mapnodebig.lua" in hintlua or picfilename.endswith("\\Big.gaf"):
        return "big"
    if "mapnodesmall.lua" in hintlua or picfilename.endswith("\\Small.gaf"):
        return "small"
    return "unknown"


def extract_node_id(name: str) -> int | None:
    match = re.fullmatch(r"worldsubnode(\d+)", name)
    if match is None:
        return None
    return int(match.group(1))


def main() -> None:
    args = parse_args()
    lines = args.ui_gcg.read_text(encoding="latin1", errors="ignore").splitlines()
    windows = parse_ui_file(lines)
    worldmap = next((window for window in windows if window["window"].get("name") == "WORLDMAP"), None)
    if worldmap is None:
        raise SystemExit("WORLDMAP window not found")

    controls = list(worldmap["controls"])
    node_controls = []
    for control in controls:
        name = str(control.get("name", ""))
        if not name.startswith("worldsubnode"):
            continue
        node_controls.append(
            {
                "controlIndex": control["index"],
                "name": name,
                "nodeId": extract_node_id(name),
                "label": str(control.get("hintstr", "")),
                "caption": str(control.get("caption", "")),
                "x": as_int(control, "x"),
                "y": as_int(control, "y"),
                "width": as_int(control, "width"),
                "height": as_int(control, "height"),
                "groupIndex": as_int(control, "groupindex"),
                "visible": as_int(control, "visable"),
                "enabled": as_int(control, "enabled"),
                "fontColor": as_int(control, "fontcolor"),
                "type": as_int(control, "type"),
                "picfilename": str(control.get("picfilename", "")),
                "hintlua": str(control.get("hintlua", "")),
                "nodeKind": classify_node(control),
            }
        )

    node_controls.sort(key=lambda item: (item["nodeId"] is None, item["nodeId"], item["controlIndex"]))

    output = {
        "source": {
            "uiGcg": str(args.ui_gcg),
            "windowName": "WORLDMAP",
        },
        "window": worldmap["window"],
        "summary": {
            "nodeCount": len(node_controls),
            "bigNodeCount": sum(1 for node in node_controls if node["nodeKind"] == "big"),
            "smallNodeCount": sum(1 for node in node_controls if node["nodeKind"] == "small"),
        },
        "worldMapNameList": next(
            (
                {
                    "controlIndex": control["index"],
                    "name": control["name"],
                    "x": as_int(control, "x"),
                    "y": as_int(control, "y"),
                    "width": as_int(control, "width"),
                    "height": as_int(control, "height"),
                    "groupIndex": as_int(control, "groupindex"),
                    "type": as_int(control, "type"),
                }
                for control in controls
                if control.get("name") == "worldmapnamelist"
            ),
            None,
        ),
        "nodes": node_controls,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(args.output)
    print(output["summary"]["nodeCount"])


if __name__ == "__main__":
    main()
