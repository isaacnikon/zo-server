#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import struct
import subprocess
import tempfile
from collections import defaultdict, deque
from pathlib import Path


SCENE_GETTER_ADDR = "0x0040f200"


def slugify(name: str) -> str:
    out = []
    for ch in name.lower():
        if ch.isalnum():
            out.append(ch)
        elif out and out[-1] != "-":
            out.append("-")
    return "".join(out).strip("-") or "map"


def run_gdb_probe(pid: int) -> tuple[int, int, int, int]:
    commands = [
        "set pagination off",
        f"set $scene=((int(*)()){SCENE_GETTER_ADDR})()",
        'printf "map=%d\\n", *(unsigned short*)$scene',
        'printf "w=%d\\n", *(unsigned short*)($scene+2)',
        'printf "h=%d\\n", *(unsigned short*)($scene+4)',
        'printf "base=0x%x\\n", *(unsigned int*)($scene+0xc)',
        "detach",
        "quit",
    ]
    proc = subprocess.run(
        ["gdb", "-q", "-p", str(pid), "-batch", *sum([["-ex", cmd] for cmd in commands], [])],
        capture_output=True,
        text=True,
        check=True,
    )
    values: dict[str, int] = {}
    combined_output = "\n".join(part for part in (proc.stdout, proc.stderr) if part)
    for line in combined_output.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key in {"map", "w", "h"}:
            values[key] = int(value, 10)
        elif key == "base":
            values[key] = int(value, 16)
    missing = {"map", "w", "h", "base"} - values.keys()
    if missing:
        raise RuntimeError(f"failed to parse gdb probe output, missing: {sorted(missing)}")
    return values["map"], values["w"], values["h"], values["base"]


def run_gdb_dump(pid: int, output_path: Path, base: int, size: int) -> None:
    end = base + size
    commands = [
        "set pagination off",
        f"dump binary memory {output_path} 0x{base:08x} 0x{end:08x}",
        "detach",
        "quit",
    ]
    subprocess.run(
        ["gdb", "-q", "-p", str(pid), "-batch", *sum([["-ex", cmd] for cmd in commands], [])],
        capture_output=True,
        text=True,
        check=True,
    )
    if not output_path.exists():
        raise RuntimeError("gdb completed without producing a dump file")


def load_tiles(path: Path, width: int, height: int) -> list[tuple[int, int, int]]:
    blob = path.read_bytes()
    expected = width * height * 6
    if len(blob) != expected:
        raise RuntimeError(f"unexpected dump size {len(blob)} != {expected}")
    tiles = []
    for off in range(0, len(blob), 6):
        tiles.append(struct.unpack_from("<HHH", blob, off))
    return tiles


def build_components(
    tiles: list[tuple[int, int, int]], width: int, height: int
) -> list[dict[str, object]]:
    visited: set[tuple[int, int]] = set()
    components: list[dict[str, object]] = []

    def tile_at(x: int, y: int) -> tuple[int, int, int]:
        return tiles[y * width + x]

    for y in range(height):
        for x in range(width):
            if (x, y) in visited:
                continue
            tile_type, script_id, aux = tile_at(x, y)
            if script_id <= 0:
                continue
            queue = deque([(x, y)])
            visited.add((x, y))
            cells: list[tuple[int, int]] = []
            tile_types = {tile_type}
            aux_values = {aux}
            while queue:
                cx, cy = queue.popleft()
                cells.append((cx, cy))
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if nx < 0 or ny < 0 or nx >= width or ny >= height or (nx, ny) in visited:
                        continue
                    nt, ns, na = tile_at(nx, ny)
                    if ns != script_id:
                        continue
                    visited.add((nx, ny))
                    tile_types.add(nt)
                    aux_values.add(na)
                    queue.append((nx, ny))
            rows: dict[int, list[int]] = defaultdict(list)
            for cx, cy in cells:
                rows[cy].append(cx)
            row_runs = []
            for row_y in sorted(rows):
                xs = sorted(rows[row_y])
                run_start = xs[0]
                prev = xs[0]
                for value in xs[1:]:
                    if value == prev + 1:
                        prev = value
                        continue
                    row_runs.append({"y": row_y, "startX": run_start, "endX": prev})
                    run_start = value
                    prev = value
                row_runs.append({"y": row_y, "startX": run_start, "endX": prev})
            xs = [cx for cx, _ in cells]
            ys = [cy for _, cy in cells]
            components.append(
                {
                    "sceneScriptId": script_id,
                    "tileTypeValues": sorted(tile_types),
                    "auxValues": sorted(aux_values),
                    "tileCount": len(cells),
                    "bbox": {
                        "minX": min(xs),
                        "minY": min(ys),
                        "maxX": max(xs),
                        "maxY": max(ys),
                    },
                    "rowRuns": row_runs,
                }
            )
    components.sort(key=lambda entry: (entry["sceneScriptId"], entry["bbox"]["minY"], entry["bbox"]["minX"]))  # type: ignore[index]
    for index, component in enumerate(components, start=1):
        component["componentIndex"] = index
    return components


def attach_focus(components: list[dict[str, object]], focus_x: int, focus_y: int) -> dict[str, object] | None:
    for component in components:
        bbox = component["bbox"]
        if not (bbox["minX"] <= focus_x <= bbox["maxX"] and bbox["minY"] <= focus_y <= bbox["maxY"]):  # type: ignore[index]
            continue
        for row in component["rowRuns"]:  # type: ignore[index]
            if row["y"] == focus_y and row["startX"] <= focus_x <= row["endX"]:
                return component
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Dump live scene-script areas from the running client.")
    parser.add_argument("--pid", type=int)
    parser.add_argument("--map-id", type=int, help="Expected map id; verified against live scene state.")
    parser.add_argument("--map-name", default="map")
    parser.add_argument("--focus-x", type=int)
    parser.add_argument("--focus-y", type=int)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    if (args.focus_x is None) != (args.focus_y is None):
        raise SystemExit("--focus-x and --focus-y must be supplied together")

    pid = args.pid
    if pid is None:
        proc = subprocess.run(
            ["pgrep", "-o", "-f", "gc12.exe"],
            capture_output=True,
            text=True,
            check=True,
        )
        pid = int(proc.stdout.strip(), 10)

    default_name = f"{args.map_id or 'unknown'}-{slugify(args.map_name)}.scene-script-areas.json"
    out_path = args.out or (Path("data/client-derived/maps") / default_name)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="scene-script-dump-") as temp_dir:
        dump_path = Path(temp_dir) / "scene.bin"
        live_map_id, width, height, base = run_gdb_probe(pid)
        if args.map_id is not None and live_map_id != args.map_id:
            raise RuntimeError(f"live map id {live_map_id} does not match requested map id {args.map_id}")
        run_gdb_dump(pid, dump_path, base, width * height * 6)
        components = build_components(load_tiles(dump_path, width, height), width, height)

    payload: dict[str, object] = {
        "mapId": live_map_id,
        "mapName": args.map_name,
        "width": width,
        "height": height,
        "componentCount": len(components),
        "areas": components,
    }

    if args.focus_x is not None and args.focus_y is not None:
        payload["focus"] = {"x": args.focus_x, "y": args.focus_y}
        payload["focusArea"] = attach_focus(components, args.focus_x, args.focus_y)

    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(out_path)


if __name__ == "__main__":
    main()
