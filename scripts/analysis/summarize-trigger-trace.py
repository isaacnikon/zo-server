#!/usr/bin/env python3
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path


TRACE_PATH = Path("data/runtime/trigger-trace.jsonl")


def main() -> None:
    if not TRACE_PATH.exists():
        raise SystemExit(f"missing trace file: {TRACE_PATH}")

    active_by_key: dict[tuple[int, int, tuple[int, ...]], set[tuple[int, int]]] = defaultdict(set)

    for line in TRACE_PATH.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if event.get("kind") != "server-run":
            continue
        map_id = int(event.get("mapId") or 0)
        subcmd = int(event.get("subcmd") or 0)
        raw_args = tuple(int(value) for value in (event.get("rawArgs") or []))
        x = event.get("x")
        y = event.get("y")
        if x is None or y is None:
            continue
        active_by_key[(map_id, subcmd, raw_args)].add((int(x), int(y)))

    summaries = []
    for (map_id, subcmd, raw_args), points in sorted(active_by_key.items()):
        xs = sorted(point[0] for point in points)
        ys = sorted(point[1] for point in points)
        summaries.append(
            {
                "mapId": map_id,
                "subcmd": subcmd,
                "rawArgs": list(raw_args),
                "sampleCount": len(points),
                "bounds": {
                    "minX": xs[0],
                    "maxX": xs[-1],
                    "minY": ys[0],
                    "maxY": ys[-1],
                },
                "points": [{"x": x, "y": y} for x, y in sorted(points)],
            }
        )

    print(json.dumps(summaries, indent=2))


if __name__ == "__main__":
    main()
