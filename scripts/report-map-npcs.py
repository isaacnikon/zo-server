#!/usr/bin/env python3
"""Report NPCs for a map from scenes.json joined with roleinfo.json."""

from __future__ import annotations

import json
import sys
from pathlib import Path


SCENES_PATH = Path("/home/nikon/projects/zo-server/data/scenes/scenes.json")
ROLEINFO_PATH = Path("/home/nikon/projects/zo-server/data/client-derived/roleinfo.json")

ROLE_CLASS_NAMES = {
    1: "player",
    2: "pet",
    3: "npc",
    4: "monster",
    5: "elite",
}


def load_scenes() -> dict:
    return json.loads(SCENES_PATH.read_text(encoding="utf-8"))["scenes"]


def load_roles() -> dict[int, dict]:
    payload = json.loads(ROLEINFO_PATH.read_text(encoding="utf-8"))
    return {int(entry["roleId"]): entry for entry in payload["entries"]}


def resolve_scene(scenes: dict, query: str | None) -> dict:
    if not query:
        query = "112"

    if query in scenes:
        return scenes[query]

    try:
        numeric = int(query)
        if str(numeric) in scenes:
            return scenes[str(numeric)]
    except ValueError:
        pass

    lowered = query.lower()
    for scene in scenes.values():
        if str(scene.get("name", "")).lower() == lowered:
            return scene

    for scene in scenes.values():
        if lowered in str(scene.get("name", "")).lower():
            return scene

    raise SystemExit(f"scene not found: {query}")


def main() -> None:
    query = " ".join(sys.argv[1:]).strip() or None
    scenes = load_scenes()
    roles = load_roles()
    scene = resolve_scene(scenes, query)

    dims = scene.get("mapDimensions") or {}
    width = int(dims.get("width", 0) or 0)
    height = int(dims.get("height", 0) or 0)

    rows = []
    for spawn in scene.get("worldSpawns", []):
        role_id = int(spawn.get("entityType", spawn.get("id", 0)))
        role = roles.get(role_id, {})
        x = int(spawn.get("x", 0))
        y = int(spawn.get("y", 0))
        out_of_bounds = width > 0 and height > 0 and not (0 <= x < width and 0 <= y < height)
        rows.append(
            {
                "roleId": role_id,
                "name": role.get("name", f"Unknown {role_id}"),
                "roleClassField": role.get("roleClassField"),
                "roleClassName": ROLE_CLASS_NAMES.get(role.get("roleClassField"), "unknown"),
                "templateFlags": spawn.get("templateFlags"),
                "x": x,
                "y": y,
                "outOfBounds": out_of_bounds,
            }
        )

    rows.sort(key=lambda row: (row["outOfBounds"], row["name"].lower(), row["roleId"], row["x"], row["y"]))

    result = {
        "scene": {
            "id": scene["id"],
            "name": scene["name"],
            "isTown": scene.get("isTown"),
            "mapDimensions": dims,
            "worldSpawnCount": len(rows),
            "outOfBoundsCount": sum(1 for row in rows if row["outOfBounds"]),
        },
        "npcs": rows,
    }

    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
