#!/usr/bin/env python3
"""Parse runtime AddMapNpc trace lines into structured JSON."""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path


LINE_RE = re.compile(
    r"AddMapNpc id=(?P<role_id>\d+) flags=(?P<flags>\d+) name=(?P<name>.*?) x=(?P<x>-?\d+) y=(?P<y>-?\d+)$"
)


def parse_lines(lines: list[str]) -> list[dict]:
    rows: list[dict] = []
    for raw in lines:
        line = raw.strip()
        match = LINE_RE.match(line)
        if not match:
            continue
        flags = int(match.group("flags"))
        rows.append(
            {
                "roleId": int(match.group("role_id")),
                "flags": flags,
                "showsUnderQuest": bool(flags & 2),
                "showsUnderFunction": bool(flags & 4),
                "name": match.group("name"),
                "x": int(match.group("x")),
                "y": int(match.group("y")),
            }
        )
    return rows


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: parse-addmapnpc-log.py <log-file>")

    path = Path(sys.argv[1])
    rows = parse_lines(path.read_text(encoding="utf-8", errors="ignore").splitlines())
    counts = Counter(row["roleId"] for row in rows)

    payload = {
        "source": str(path),
        "count": len(rows),
        "duplicateRoleIds": {str(role_id): count for role_id, count in sorted(counts.items()) if count > 1},
        "rows": rows,
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
