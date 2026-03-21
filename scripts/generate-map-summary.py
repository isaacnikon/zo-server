#!/usr/bin/env python3
"""Build a normalized per-map dataset from generated client-derived JSON files."""

from __future__ import annotations

import json
from pathlib import Path


MAPS_DIR = Path("data/client-derived/maps")
WORLDMAP_DATASET_PATH = MAPS_DIR / "worldmap.json"
MAP_DETAILS_INDEX_PATH = MAPS_DIR / "map-details.index.json"
MAP_NPCS_INDEX_PATH = MAPS_DIR / "map-npcs.index.json"
MAP_TELEPORTERS_PATH = MAPS_DIR / "map-teleporters.json"
OUTPUT_PATH = MAPS_DIR / "map-summary.json"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def iter_generated_map_files(pattern: str) -> list[Path]:
    return sorted(MAPS_DIR.glob(pattern))


def build_map_details_summary(details: dict | None) -> dict | None:
    if not details:
        return None
    map_config = details.get("mapConfig") or {}
    return {
        "titleText": details["bigTexts"][0]["text"] if details.get("bigTexts") else details["mapName"],
        "homeInfo": details.get("homeInfo"),
        "temporaryPointCount": len(details.get("temporaryMapPoints", [])),
        "sceneTransitionCount": len(details.get("sceneTransitions", [])),
        "portalEffectCandidateCount": len(map_config.get("portalEffectCandidates", [])),
        "observedTriggerPointCount": len(map_config.get("observedTriggerPoints", [])),
    }


def build_npc_summary(npcs_doc: dict | None) -> dict | None:
    if not npcs_doc:
        return None
    validation = npcs_doc.get("validationSummary") or {}
    return {
        "totalNpcCount": len(npcs_doc.get("npcs", [])),
        "statusCounts": validation.get("statusCounts", {}),
    }


def build_scene_script_summary(scene_script_doc: dict | None) -> dict | None:
    if not scene_script_doc:
        return None
    focus_area = scene_script_doc.get("focusArea")
    return {
        "componentCount": scene_script_doc.get("componentCount", 0),
        "focusSceneScriptId": focus_area.get("sceneScriptId") if focus_area else None,
        "focusTileCount": focus_area.get("tileCount") if focus_area else None,
        "focusBbox": focus_area.get("bbox") if focus_area else None,
    }


def build_teleporter_summary(teleporter_doc: dict | None) -> dict | None:
    if not teleporter_doc:
        return None
    teleporters = teleporter_doc.get("teleporters") or []
    return {
        "teleporterCount": len(teleporters),
        "manualTargetCandidateCount": sum(
            1
            for teleporter in teleporters
            for candidate in teleporter.get("targetCandidates", [])
            if candidate.get("source") == "manual-link"
        ),
        "worldMapTargetCandidateCount": sum(
            1
            for teleporter in teleporters
            for candidate in teleporter.get("targetCandidates", [])
            if candidate.get("source") == "worldmap-connection"
        ),
    }


def main() -> None:
    worldmap = load_json(WORLDMAP_DATASET_PATH)
    map_details_index = load_json(MAP_DETAILS_INDEX_PATH)
    map_npcs_index = load_json(MAP_NPCS_INDEX_PATH)
    map_teleporters = load_json(MAP_TELEPORTERS_PATH) if MAP_TELEPORTERS_PATH.exists() else {"maps": []}

    details_by_id: dict[int, dict] = {}
    for path in iter_generated_map_files("[0-9][0-9][0-9]-*.map-details.json"):
        doc = load_json(path)
        details_by_id[int(doc["mapId"])] = {
            "path": str(path),
            "data": doc,
        }

    npcs_by_id: dict[int, dict] = {}
    for path in iter_generated_map_files("[0-9][0-9][0-9]-*.npcs.json"):
        doc = load_json(path)
        npcs_by_id[int(doc["mapId"])] = {
            "path": str(path),
            "data": doc,
        }

    scene_scripts_by_id: dict[int, dict] = {}
    for path in iter_generated_map_files("[0-9][0-9][0-9]-*.scene-script-areas.json"):
        doc = load_json(path)
        scene_scripts_by_id[int(doc["mapId"])] = {
            "path": str(path),
            "data": doc,
        }

    teleporters_by_id: dict[int, dict] = {}
    for entry in map_teleporters.get("maps", []):
        if not entry or not isinstance(entry.get("mapId"), int):
            continue
        teleporters_by_id[int(entry["mapId"])] = {
            "path": str(MAP_TELEPORTERS_PATH),
            "data": entry,
        }

    worldmap_nodes_by_id: dict[int, dict] = {}
    worldmap_nodes_by_name: dict[str, dict] = {}
    for node in worldmap["nodes"]:
        worldmap_nodes_by_name[node["mapName"]] = node
        if node.get("mapId") is not None:
            worldmap_nodes_by_id[int(node["mapId"])] = node

    connections_by_id: dict[int, list[dict]] = {}
    connections_by_name: dict[str, list[dict]] = {}
    for edge in worldmap["connections"]:
        if edge.get("fromMapId") is not None:
            connections_by_id.setdefault(int(edge["fromMapId"]), []).append(edge)
        if edge.get("toMapId") is not None:
            connections_by_id.setdefault(int(edge["toMapId"]), []).append(edge)
        connections_by_name.setdefault(edge["fromMapName"], []).append(edge)
        connections_by_name.setdefault(edge["toMapName"], []).append(edge)

    all_map_ids = sorted(set(details_by_id) | set(npcs_by_id) | set(scene_scripts_by_id) | set(teleporters_by_id) | set(worldmap_nodes_by_id))
    maps = []
    for map_id in all_map_ids:
        details_entry = details_by_id.get(map_id)
        npcs_entry = npcs_by_id.get(map_id)
        scene_scripts_entry = scene_scripts_by_id.get(map_id)
        teleporter_entry = teleporters_by_id.get(map_id)
        details = details_entry["data"] if details_entry else None
        npcs_doc = npcs_entry["data"] if npcs_entry else None
        scene_script_doc = scene_scripts_entry["data"] if scene_scripts_entry else None
        teleporter_doc = teleporter_entry["data"] if teleporter_entry else None
        map_name = (
            details["mapName"]
            if details
            else npcs_doc["mapName"]
            if npcs_doc
            else scene_script_doc["mapName"]
            if scene_script_doc
            else worldmap_nodes_by_id[map_id]["mapName"]
        )
        world_node = worldmap_nodes_by_id.get(map_id) or worldmap_nodes_by_name.get(map_name)
        connection_candidates = {
            (
                edge["fromMapName"],
                edge["toMapName"],
                edge.get("order", 0),
            ): edge
            for edge in connections_by_id.get(map_id, []) + connections_by_name.get(map_name, [])
        }
        maps.append(
            {
                "mapId": map_id,
                "mapName": map_name,
                "mapDetailsPath": details_entry["path"] if details_entry else None,
                "mapDetailsSummary": build_map_details_summary(details),
                "npcsPath": npcs_entry["path"] if npcs_entry else None,
                "npcSummary": build_npc_summary(npcs_doc),
                "sceneScriptAreasPath": scene_scripts_entry["path"] if scene_scripts_entry else None,
                "sceneScriptSummary": build_scene_script_summary(scene_script_doc),
                "teleportersPath": teleporter_entry["path"] if teleporter_entry else None,
                "teleporterSummary": build_teleporter_summary(teleporter_doc),
                "worldMap": (
                    {
                        "nodeId": world_node["nodeId"],
                        "nodeName": world_node["nodeName"],
                        "nodeKind": world_node["nodeKind"],
                        "x": world_node["x"],
                        "y": world_node["y"],
                        "width": world_node["width"],
                        "height": world_node["height"],
                        "hintlua": world_node.get("hintlua"),
                        "adjacent": world_node.get("adjacent", []),
                    }
                    if world_node
                    else None
                ),
                "connections": sorted(
                    connection_candidates.values(),
                    key=lambda edge: (
                        edge["fromMapName"],
                        edge["toMapName"],
                        edge.get("order", 0),
                    ),
                ),
            }
        )

    output = {
        "source": {
            "worldmap": str(WORLDMAP_DATASET_PATH),
            "mapDetailsIndex": str(MAP_DETAILS_INDEX_PATH),
            "mapNpcsIndex": str(MAP_NPCS_INDEX_PATH),
            "generator": "scripts/generate-map-summary.py",
        },
        "summary": {
            "mapCount": len(maps),
            "mapsWithDetails": len(details_by_id),
            "mapsWithNpcs": len(npcs_by_id),
            "mapsWithSceneScriptAreas": len(scene_scripts_by_id),
            "mapsWithTeleporterData": len(teleporters_by_id),
            "mapsOnWorldMap": len(worldmap_nodes_by_id),
            "mapsSkippedByDetailsExtractor": map_details_index["summary"]["mapsSkipped"],
            "mapsSkippedByNpcExtractor": map_npcs_index["summary"]["mapsSkipped"],
            "authoritativeForTeleportRouting": False,
        },
        "maps": maps,
    }

    OUTPUT_PATH.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(OUTPUT_PATH)
    print(output["summary"]["mapCount"])
    print(output["summary"]["mapsWithDetails"])
    print(output["summary"]["mapsWithNpcs"])
    print(output["summary"]["mapsOnWorldMap"])


if __name__ == "__main__":
    main()
