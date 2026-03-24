#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAPS_DIR = ROOT / "data" / "client-derived" / "maps"
MAP_SUMMARY_PATH = MAPS_DIR / "map-summary.json"
SCENE_GETTER_ADDR = "0x0040f200"
SCENE_ENTER_ADDR = "0x004113b0"
SCENE_CLIENT_ROOT_PTR_ADDR = "0x0064328c"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def run_command(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )


def get_default_pid() -> int:
    proc = run_command(["pgrep", "-o", "-f", "gc12.exe"])
    return int(proc.stdout.strip(), 10)


def get_map_records() -> dict[int, dict]:
    summary = load_json(MAP_SUMMARY_PATH)
    return {int(record["mapId"]): record for record in summary.get("maps", [])}


def get_home_position(record: dict | None) -> tuple[int, int]:
    home = ((record or {}).get("mapDetailsSummary") or {}).get("homeInfo") or {}
    x = int(home.get("x", 8))
    y = int(home.get("y", 8))
    return x, y


def call_scene_enter(pid: int, map_id: int, x: int, y: int) -> str:
    commands = [
        "set pagination off",
        f"set $scene_client=*(void**){SCENE_CLIENT_ROOT_PTR_ADDR}",
        f"set $fn=(unsigned int (*)(void*, unsigned int, int, int)){SCENE_ENTER_ADDR}",
        f'printf "loading map=%d x=%d y=%d\\n", {map_id}, {x}, {y}',
        f"call $fn($scene_client, {map_id}, {x}, {y})",
        "detach",
        "quit",
    ]
    proc = run_command(
        ["gdb", "-q", "-p", str(pid), "-batch", *sum([["-ex", cmd] for cmd in commands], [])]
    )
    return "\n".join(part for part in (proc.stdout, proc.stderr) if part).strip()


def dump_loaded_scene(pid: int, record: dict, focus_x: int | None, focus_y: int | None) -> Path:
    command = [
        sys.executable,
        "scripts/dump-live-scene-script-areas.py",
        "--pid",
        str(pid),
        "--map-id",
        str(record["mapId"]),
        "--map-name",
        record["mapName"],
    ]
    if focus_x is not None and focus_y is not None:
        command.extend(["--focus-x", str(focus_x), "--focus-y", str(focus_y)])
    proc = run_command(command)
    lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
    return Path(lines[-1])


def refresh_indexes() -> None:
    for script in (
        "scripts/generate-scene-script-area-index.py",
        "scripts/generate-map-summary.py",
    ):
        proc = run_command([sys.executable, script])
        print(proc.stdout.strip())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Load maps into the running client and dump scene-script areas.")
    parser.add_argument("--pid", type=int)
    parser.add_argument("--map-id", type=int, action="append", dest="map_ids")
    parser.add_argument("--all-missing", action="store_true")
    parser.add_argument("--sleep-ms", type=int, default=250)
    parser.add_argument("--focus-x", type=int)
    parser.add_argument("--focus-y", type=int)
    parser.add_argument("--no-refresh", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if (args.focus_x is None) != (args.focus_y is None):
        raise SystemExit("--focus-x and --focus-y must be supplied together")

    records_by_id = get_map_records()
    target_ids: list[int]
    if args.all_missing:
        target_ids = [
            map_id
            for map_id, record in records_by_id.items()
            if not record.get("sceneScriptAreasPath")
        ]
    else:
        target_ids = args.map_ids or []
    if not target_ids:
        raise SystemExit("supply --map-id or --all-missing")

    pid = args.pid or get_default_pid()
    dumped_paths: list[Path] = []

    for map_id in target_ids:
        record = records_by_id.get(map_id)
        if not record:
            print(f"skip map {map_id}: not present in map-summary.json", file=sys.stderr)
            continue
        x, y = get_home_position(record)
        print(f"[load] map={map_id} name={record['mapName']} x={x} y={y}")
        print(call_scene_enter(pid, map_id, x, y))
        time.sleep(max(args.sleep_ms, 0) / 1000.0)
        dumped = dump_loaded_scene(pid, record, args.focus_x, args.focus_y)
        dumped_paths.append(dumped)
        print(f"[dump] {dumped}")

    if not args.no_refresh:
        refresh_indexes()

    print(json.dumps({"dumped": [str(path) for path in dumped_paths]}, indent=2))


if __name__ == "__main__":
    main()
