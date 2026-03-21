#!/usr/bin/env python3
"""Generate a canonical per-scene NPC dataset from all current client-derived sources."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
SCENES_PATH = REPO_ROOT / "data" / "scenes" / "scenes.json"
ROLEINFO_PATH = REPO_ROOT / "data" / "client-derived" / "roleinfo.json"
MAP_SIDEBAR_PATH = REPO_ROOT / "data" / "client-derived" / "map-sidebar-npcs.json"
MAP_NPC_INFO_PATH = REPO_ROOT / "data" / "client-derived" / "map-npc-info.json"
OUTPUT_PATH = REPO_ROOT / "data" / "client-derived" / "map-npcs.json"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_roleinfo() -> dict[int, dict]:
    payload = load_json(ROLEINFO_PATH)
    return {
        int(entry["roleId"]): entry
        for entry in payload.get("entries", [])
        if isinstance(entry, dict) and isinstance(entry.get("roleId"), int)
    }


def scene_template(scene: dict) -> dict:
    return {
        "sceneId": int(scene["id"]),
        "sceneName": scene.get("name"),
        "isTown": bool(scene.get("isTown")),
        "mapDimensions": scene.get("mapDimensions") or {},
        "npcCount": 0,
        "npcs": {},
    }


def npc_template(scene_id: int, role_id: int, roleinfo: dict | None) -> dict:
    return {
        "sceneId": scene_id,
        "roleId": role_id,
        "roleName": (roleinfo or {}).get("name"),
        "roleClassField": (roleinfo or {}).get("roleClassField"),
        "roleGroupField": (roleinfo or {}).get("roleGroupField"),
        "description": (roleinfo or {}).get("description"),
        "sources": {
            "worldSpawn": False,
            "sidebarStatic": False,
            "sidebarRuntime": False,
            "hiddenMapInfo": False,
        },
        "worldSpawns": [],
        "sidebar": {
            "staticRows": [],
            "runtimeRows": [],
        },
        "mapInfo": None,
    }


def get_or_create_npc(scene_record: dict, role_id: int, roleinfo_by_id: dict[int, dict]) -> dict:
    key = str(role_id)
    npc = scene_record["npcs"].get(key)
    if npc is None:
        npc = npc_template(scene_record["sceneId"], role_id, roleinfo_by_id.get(role_id))
        scene_record["npcs"][key] = npc
    return npc


def build_sidebar_indexes(sidebar_payload: dict) -> tuple[dict[int, list[dict]], dict[int, list[dict]]]:
    static_by_scene: dict[int, list[dict]] = {}
    runtime_by_scene: dict[int, list[dict]] = {}
    for scene in sidebar_payload.get("scenes", []):
        scene_id = scene.get("sceneId")
        if not isinstance(scene_id, int):
            continue
        static_rows = []
        for block in scene.get("staticBlocks", []):
            for row in block.get("rows", []):
                static_rows.append(
                    {
                        "blockTitle": block.get("title"),
                        "blockIndex": block.get("blockIndex"),
                        "offset": block.get("offset"),
                        **row,
                    }
                )
        runtime_rows = []
        for capture in scene.get("runtimeCaptures", []):
            for row in capture.get("rows", []):
                runtime_rows.append(
                    {
                        "capturePath": capture.get("path"),
                        "capturedAt": capture.get("capturedAt"),
                        "mapName": capture.get("mapName"),
                        **row,
                    }
                )
        static_by_scene[scene_id] = static_rows
        runtime_by_scene[scene_id] = runtime_rows
    return static_by_scene, runtime_by_scene


def main() -> None:
    scenes_payload = load_json(SCENES_PATH)
    sidebar_payload = load_json(MAP_SIDEBAR_PATH)
    map_info_payload = load_json(MAP_NPC_INFO_PATH)
    roleinfo_by_id = load_roleinfo()

    static_sidebar_by_scene, runtime_sidebar_by_scene = build_sidebar_indexes(sidebar_payload)
    map_info_by_scene = map_info_payload.get("scenes", {})

    scene_records: dict[str, dict] = {}
    for scene_id_str, scene in sorted(
        scenes_payload.get("scenes", {}).items(),
        key=lambda item: int(item[0]) if str(item[0]).isdigit() else 1_000_000,
    ):
        if not str(scene_id_str).isdigit():
            continue
        scene_records[str(scene_id_str)] = scene_template(scene)

    for scene_id_str, scene_record in scene_records.items():
        scene = scenes_payload["scenes"][scene_id_str]
        scene_id = int(scene_id_str)

        for spawn in scene.get("worldSpawns", []):
            role_id = int(spawn.get("entityType", 0) or 0)
            if role_id <= 0:
                continue
            npc = get_or_create_npc(scene_record, role_id, roleinfo_by_id)
            npc["sources"]["worldSpawn"] = True
            npc["worldSpawns"].append(
                {
                    "spawnId": spawn.get("id"),
                    "entityType": spawn.get("entityType"),
                    "templateFlags": spawn.get("templateFlags"),
                    "x": spawn.get("x"),
                    "y": spawn.get("y"),
                }
            )

        for row in static_sidebar_by_scene.get(scene_id, []):
            role_id = int(row.get("roleId", 0) or 0)
            if role_id <= 0:
                continue
            npc = get_or_create_npc(scene_record, role_id, roleinfo_by_id)
            npc["sources"]["sidebarStatic"] = True
            npc["sidebar"]["staticRows"].append(
                {
                    "blockTitle": row.get("blockTitle"),
                    "blockIndex": row.get("blockIndex"),
                    "offset": row.get("offset"),
                    "flagMask": row.get("flagMask"),
                    "showsUnderQuest": row.get("showsUnderQuest"),
                    "showsUnderFunction": row.get("showsUnderFunction"),
                    "resolvedName": row.get("resolvedName"),
                    "x": row.get("x"),
                    "y": row.get("y"),
                    "outOfBounds": row.get("outOfBounds"),
                }
            )

        for row in runtime_sidebar_by_scene.get(scene_id, []):
            role_id = int(row.get("roleId", 0) or 0)
            if role_id <= 0:
                continue
            npc = get_or_create_npc(scene_record, role_id, roleinfo_by_id)
            npc["sources"]["sidebarRuntime"] = True
            npc["sidebar"]["runtimeRows"].append(
                {
                    "capturePath": row.get("capturePath"),
                    "capturedAt": row.get("capturedAt"),
                    "mapName": row.get("mapName"),
                    "flags": row.get("flags"),
                    "showsUnderQuest": row.get("showsUnderQuest"),
                    "showsUnderFunction": row.get("showsUnderFunction"),
                    "name": row.get("name"),
                    "x": row.get("x"),
                    "y": row.get("y"),
                    "outOfBounds": row.get("outOfBounds"),
                }
            )

        map_info_scene = map_info_by_scene.get(scene_id_str)
        if isinstance(map_info_scene, dict):
            for info in map_info_scene.get("npcs", []):
                role_id = int(info.get("roleId", 0) or 0)
                if role_id <= 0:
                    continue
                npc = get_or_create_npc(scene_record, role_id, roleinfo_by_id)
                npc["sources"]["hiddenMapInfo"] = True
                npc["mapInfo"] = {
                    "scriptName": info.get("scriptName"),
                    "scriptPath": info.get("scriptPath"),
                    "recordAddress": info.get("recordAddress"),
                    "dataOffset": info.get("dataOffset"),
                    "size": info.get("size"),
                    "leadingThreshold": info.get("leadingThreshold"),
                    "entries": info.get("entries", []),
                    "extraEntries": info.get("extraEntries", []),
                    "summary": info.get("summary", {}),
                }

        normalized_npcs = []
        for role_id_str, npc in sorted(scene_record["npcs"].items(), key=lambda item: int(item[0])):
            normalized_npcs.append(
                {
                    **npc,
                    "summary": {
                        "worldSpawnCount": len(npc["worldSpawns"]),
                        "sidebarStaticCount": len(npc["sidebar"]["staticRows"]),
                        "sidebarRuntimeCount": len(npc["sidebar"]["runtimeRows"]),
                        "hasMapInfo": npc["mapInfo"] is not None,
                    },
                }
            )
        scene_record["npcCount"] = len(normalized_npcs)
        scene_record["npcs"] = normalized_npcs

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sources": {
            "scenes": str(SCENES_PATH),
            "roleinfo": str(ROLEINFO_PATH),
            "mapSidebarNpcs": str(MAP_SIDEBAR_PATH),
            "mapNpcInfo": str(MAP_NPC_INFO_PATH),
        },
        "summary": {
            "sceneCount": len(scene_records),
            "npcCount": sum(scene["npcCount"] for scene in scene_records.values()),
            "scenesWithWorldSpawns": sum(
                1 for scene in scene_records.values() if any(npc["sources"]["worldSpawn"] for npc in scene["npcs"])
            ),
            "scenesWithSidebarStatic": sum(
                1 for scene in scene_records.values() if any(npc["sources"]["sidebarStatic"] for npc in scene["npcs"])
            ),
            "scenesWithSidebarRuntime": sum(
                1 for scene in scene_records.values() if any(npc["sources"]["sidebarRuntime"] for npc in scene["npcs"])
            ),
            "scenesWithHiddenMapInfo": sum(
                1 for scene in scene_records.values() if any(npc["sources"]["hiddenMapInfo"] for npc in scene["npcs"])
            ),
        },
        "scenes": scene_records,
    }

    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(OUTPUT_PATH.resolve())
    print(json.dumps(payload["summary"]))


if __name__ == "__main__":
    main()
