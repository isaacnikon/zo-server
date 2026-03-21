#!/usr/bin/env python3
"""Build a consolidated world-map dataset for UI consumption."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path


MAPS_DIR = Path("data/client-derived/maps")
WORLDMAP_NODES_PATH = MAPS_DIR / "worldmap-nodes.json"
WORLDMAP_CONNECTIONS_PATH = MAPS_DIR / "worldmap-connections.json"
OUTPUT_PATH = MAPS_DIR / "worldmap.json"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_map_details() -> dict[str, dict]:
    by_name: dict[str, dict] = {}
    paths = sorted(
        MAPS_DIR.glob("*.map-details.json"),
        key=lambda path: (0 if re.match(r"^\d+-", path.name) else 1, path.name),
    )
    for path in paths:
        obj = load_json(path)
        by_name.setdefault(
            obj["mapName"],
            {
                "path": str(path),
                "data": obj,
            },
        )
    return by_name


def main() -> None:
    nodes_doc = load_json(WORLDMAP_NODES_PATH)
    connections_doc = load_json(WORLDMAP_CONNECTIONS_PATH)
    map_details = load_map_details()

    def build_map_details_summary(details: dict | None) -> dict | None:
        if not details:
            return None
        return {
            "titleText": details["bigTexts"][0]["text"] if details.get("bigTexts") else details["mapName"],
            "homeInfo": details.get("homeInfo"),
            "temporaryPointCount": len(details.get("temporaryMapPoints", [])),
            "sceneTransitionCount": len(details.get("sceneTransitions", [])),
            "portalEffectCandidateCount": len(details.get("mapConfig", {}).get("portalEffectCandidates", []))
            if details.get("mapConfig")
            else 0,
        }

    adjacency: dict[str, list[dict]] = defaultdict(list)
    for edge in connections_doc["connections"]:
        adjacency[edge["fromMapName"]].append(
            {
                "toMapName": edge["toMapName"],
                "toMapId": edge["toMapId"],
                "validation": edge["validation"],
                "connectionType": edge["connectionType"],
                "authority": edge["authority"],
            }
        )
        adjacency[edge["toMapName"]].append(
            {
                "toMapName": edge["fromMapName"],
                "toMapId": edge["fromMapId"],
                "validation": edge["validation"],
                "connectionType": edge["connectionType"],
                "authority": edge["authority"],
            }
        )

    nodes = []
    for node in nodes_doc["nodes"]:
        details_entry = map_details.get(node["label"])
        details = details_entry["data"] if details_entry else None
        nodes.append(
            {
                "mapName": node["label"],
                "mapId": details["mapId"] if details else None,
                "nodeId": node["nodeId"],
                "nodeName": node["name"],
                "nodeKind": node["nodeKind"],
                "x": node["x"],
                "y": node["y"],
                "width": node["width"],
                "height": node["height"],
                "hintlua": node.get("hintlua"),
                "mapDetailsPath": details_entry["path"] if details_entry else None,
                "mapDetailsSummary": build_map_details_summary(details),
                "adjacent": sorted(adjacency.get(node["label"], []), key=lambda item: item["toMapName"]),
            }
        )

    connections = []
    for edge in connections_doc["connections"]:
        from_details_entry = map_details.get(edge["fromMapName"])
        to_details_entry = map_details.get(edge["toMapName"])
        from_details = from_details_entry["data"] if from_details_entry else None
        to_details = to_details_entry["data"] if to_details_entry else None
        connections.append(
            {
                **edge,
                "fromMapId": edge.get("fromMapId")
                if edge.get("fromMapId") is not None
                else (from_details["mapId"] if from_details else None),
                "toMapId": edge.get("toMapId")
                if edge.get("toMapId") is not None
                else (to_details["mapId"] if to_details else None),
                "fromMapDetailsPath": from_details_entry["path"] if from_details_entry else None,
                "toMapDetailsPath": to_details_entry["path"] if to_details_entry else None,
                "fromMapDetailsSummary": build_map_details_summary(from_details),
                "toMapDetailsSummary": build_map_details_summary(to_details),
            }
        )

    output = {
        "source": {
            "nodes": str(WORLDMAP_NODES_PATH),
            "connections": str(WORLDMAP_CONNECTIONS_PATH),
            "generator": "scripts/generate-worldmap-dataset.py",
        },
        "summary": {
            "nodeCount": len(nodes),
            "connectionCount": len(connections),
            "authoritativeForTeleportRouting": False,
        },
        "nodes": nodes,
        "connections": connections,
    }

    OUTPUT_PATH.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(OUTPUT_PATH)
    print(output["summary"]["nodeCount"])
    print(output["summary"]["connectionCount"])


if __name__ == "__main__":
    main()
