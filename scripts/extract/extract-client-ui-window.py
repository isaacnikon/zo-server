#!/usr/bin/env python3
"""Extract a named UI window and its controls from Zodiac Online ui.gcg."""

from __future__ import annotations

import json
import sys
from pathlib import Path


DEFAULT_UI_GCG = Path("/home/nikon/Data/Zodiac Online/gcg/ui.gcg")


def parse_ui_file(lines: list[str]) -> list[dict]:
    windows: list[dict] = []
    current_window: dict | None = None
    current_control: dict | None = None

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


def main() -> None:
    ui_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_UI_GCG
    window_name = sys.argv[2] if len(sys.argv) > 2 else "MAINMAP"

    lines = ui_path.read_text(encoding="latin1").splitlines()
    windows = parse_ui_file(lines)

    match = next((window for window in windows if window["window"].get("name") == window_name), None)
    if match is None:
        raise SystemExit(f"window not found: {window_name}")

    print(
        json.dumps(
            {
                "source": str(ui_path),
                "window": match["window"],
                "controls": match["controls"],
            },
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
