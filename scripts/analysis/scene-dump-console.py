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
INDEX_PATH = MAPS_DIR / "scene-script-areas.index.json"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def run_command(args: list[str]) -> str:
    proc = subprocess.run(
        args,
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return proc.stdout.strip()


def probe_live_map(pid: int | None = None) -> dict[str, int]:
    command = [sys.executable, "scripts/dump-live-scene-script-areas.py"]
    if pid is not None:
        command.extend(["--pid", str(pid)])
    command.extend(["--out", "/tmp/scene-probe.json"])
    output_path = Path(run_command(command).splitlines()[-1].strip())
    doc = load_json(output_path)
    return {
        "mapId": int(doc["mapId"]),
        "width": int(doc["width"]),
        "height": int(doc["height"]),
    }


def get_map_record(map_id: int) -> dict | None:
    summary = load_json(MAP_SUMMARY_PATH)
    for record in summary.get("maps", []):
        if int(record["mapId"]) == map_id:
            return record
    return None


def capture_current_scene(pid: int | None, focus_x: int | None, focus_y: int | None, refresh: bool) -> None:
    live = probe_live_map(pid)
    record = get_map_record(live["mapId"])
    map_name = record["mapName"] if record else f"map-{live['mapId']}"

    command = [
        sys.executable,
        "scripts/dump-live-scene-script-areas.py",
        "--map-id",
        str(live["mapId"]),
        "--map-name",
        map_name,
    ]
    if pid is not None:
        command.extend(["--pid", str(pid)])
    if focus_x is not None and focus_y is not None:
        command.extend(["--focus-x", str(focus_x), "--focus-y", str(focus_y)])

    output = run_command(command)
    print(output)

    if refresh:
        refresh_generated_indexes()


def capture_live_map(pid: int | None, map_id: int, refresh: bool) -> Path:
    record = get_map_record(map_id)
    map_name = record["mapName"] if record else f"map-{map_id}"
    command = [
        sys.executable,
        "scripts/dump-live-scene-script-areas.py",
        "--map-id",
        str(map_id),
        "--map-name",
        map_name,
    ]
    if pid is not None:
        command.extend(["--pid", str(pid)])
    output = run_command(command)
    output_path = Path(output.splitlines()[-1].strip())
    print(output_path)
    if refresh:
        refresh_generated_indexes()
    return output_path


def refresh_generated_indexes() -> None:
    for script in (
        "scripts/generate-scene-script-area-index.py",
        "scripts/generate-map-summary.py",
    ):
        print(run_command([sys.executable, script]))


def print_missing(limit: int) -> None:
    index = load_json(INDEX_PATH)
    print(json.dumps(index["summary"], indent=2))
    for entry in index.get("missing", [])[:limit]:
        print(f'{entry["mapId"]:>3}  {entry["mapName"]}')


def print_current_status(pid: int | None) -> None:
    live = probe_live_map(pid)
    record = get_map_record(live["mapId"])
    print(json.dumps(
        {
            "liveMapId": live["mapId"],
            "liveMapName": record["mapName"] if record else None,
            "width": live["width"],
            "height": live["height"],
            "sceneScriptPath": record.get("sceneScriptAreasPath") if record else None,
        },
        indent=2,
    ))


def watch_live_maps(pid: int | None, poll_ms: int, once_per_map: bool, refresh: bool) -> None:
    seen: set[int] = set()
    while True:
        try:
            live = probe_live_map(pid)
        except subprocess.CalledProcessError as error:
            print(f"probe failed: {error}", file=sys.stderr)
            time.sleep(max(poll_ms, 100) / 1000.0)
            continue

        map_id = live["mapId"]
        if not once_per_map or map_id not in seen:
            capture_live_map(pid, map_id, refresh)
            if once_per_map:
                seen.add(map_id)
        time.sleep(max(poll_ms, 100) / 1000.0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Console wrapper for live scene-script area dumps.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    current = subparsers.add_parser("current", help="Dump the currently loaded live map.")
    current.add_argument("--pid", type=int)
    current.add_argument("--focus-x", type=int)
    current.add_argument("--focus-y", type=int)
    current.add_argument("--no-refresh", action="store_true")

    status = subparsers.add_parser("status", help="Show the currently loaded live map.")
    status.add_argument("--pid", type=int)

    watch = subparsers.add_parser("watch", help="Poll the live client and dump each newly loaded map once.")
    watch.add_argument("--pid", type=int)
    watch.add_argument("--poll-ms", type=int, default=1500)
    watch.add_argument("--no-refresh", action="store_true")
    watch.add_argument("--allow-repeat", action="store_true")

    missing = subparsers.add_parser("missing", help="Show maps still missing scene-script dumps.")
    missing.add_argument("--limit", type=int, default=20)

    subparsers.add_parser("refresh", help="Refresh derived scene-script indexes.")

    args = parser.parse_args()

    if getattr(args, "focus_x", None) is not None and getattr(args, "focus_y", None) is None:
        raise SystemExit("--focus-x and --focus-y must be supplied together")
    if getattr(args, "focus_y", None) is not None and getattr(args, "focus_x", None) is None:
        raise SystemExit("--focus-x and --focus-y must be supplied together")

    if args.command == "current":
        capture_current_scene(args.pid, args.focus_x, args.focus_y, not args.no_refresh)
        return
    if args.command == "status":
        print_current_status(args.pid)
        return
    if args.command == "missing":
        print_missing(args.limit)
        return
    if args.command == "watch":
        watch_live_maps(args.pid, args.poll_ms, not args.allow_repeat, not args.no_refresh)
        return
    if args.command == "refresh":
        refresh_generated_indexes()
        return
    raise SystemExit(f"unknown command: {args.command}")


if __name__ == "__main__":
    main()
