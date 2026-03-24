#!/usr/bin/env python3
"""Generate inferred world-map connections from extracted node data."""

from __future__ import annotations

import json
import re
from pathlib import Path


WORLDMAP_NODES_PATH = Path("data/client-derived/maps/worldmap-nodes.json")
MAP_DETAILS_DIR = Path("data/client-derived/maps")
OUTPUT_PATH = Path("data/client-derived/maps/worldmap-connections.json")


LOCAL_NEIGHBOR_THRESHOLD = 33.0
LOCAL_NEIGHBOR_LIMIT = 3

VALIDATED_CONNECTIONS = {
    tuple(sorted(("Rainbow Valley", "Bling Spring"))): {
        "validation": "validated-manually",
        "notes": "Validated from in-game travel and minimap teleporter investigation; not yet backed by extracted trigger destination code.",
    }
}

BRIDGE_EDGES = [
    ("Trident Mountain", "Chill Pass"),
    ("Precious Garden", "Mega Forest"),
    ("Longicorn Hole", "Longicorn  State"),
    ("Longicorn  State", "Chain Peak"),
    ("Thorn Mountain", "Hell Pass"),
    ("Soul-free Valley", "Triumph Path"),
    ("Dew Peak", "Dragon Palace"),
]

EXCLUDED_EDGES = {
    tuple(sorted(("Bling Spring", "Darkness Hole"))),
    tuple(sorted(("Bling Alley", "Darkness Hole"))),
}

LOCKED_NEIGHBORS = {
    "Rainbow Valley": {"Bling Spring"},
    "Bling Spring": {"Rainbow Valley", "Bling Alley"},
    "Bling Alley": {"Bling Spring", "Cloud City"},
    "Cloud City": {"Bling Alley", "Fall Alley", "Limon District"},
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_map_details() -> dict[str, dict]:
    mapping: dict[str, dict] = {}
    paths = sorted(
        MAP_DETAILS_DIR.glob("*.map-details.json"),
        key=lambda path: (0 if re.match(r"^\d+-", path.name) else 1, path.name),
    )
    for path in paths:
        obj = load_json(path)
        mapping.setdefault(obj["mapName"], obj)
    return mapping


def index_nodes_by_label(worldmap_nodes: dict) -> dict[str, dict]:
    return {node["label"]: node for node in worldmap_nodes["nodes"]}


def distance(a: dict, b: dict) -> float:
    return ((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2) ** 0.5


def infer_local_edges(nodes: list[dict]) -> set[tuple[str, str]]:
    neighbors: dict[str, list[str]] = {}
    for node in nodes:
        ranked = sorted(
            (
                (distance(node, other), other["label"])
                for other in nodes
                if other["label"] != node["label"]
            ),
            key=lambda item: item[0],
        )
        neighbors[node["label"]] = [
            label for dist, label in ranked[:LOCAL_NEIGHBOR_LIMIT] if dist <= LOCAL_NEIGHBOR_THRESHOLD
        ]

    edges: set[tuple[str, str]] = set()
    for label, local_neighbors in neighbors.items():
        for other in local_neighbors:
            if label in neighbors.get(other, []):
                edges.add(tuple(sorted((label, other))))
    return edges


def build_connections() -> dict:
    worldmap_nodes = load_json(WORLDMAP_NODES_PATH)
    nodes_by_label = index_nodes_by_label(worldmap_nodes)
    map_details_by_name = load_map_details()
    inferred_edges = infer_local_edges(worldmap_nodes["nodes"])
    inferred_edges.update(tuple(sorted(edge)) for edge in BRIDGE_EDGES)
    inferred_edges.difference_update(EXCLUDED_EDGES)

    # Honor map-reference-validated local topology for ambiguous clusters.
    for label, allowed_neighbors in LOCKED_NEIGHBORS.items():
        for edge in list(inferred_edges):
            if label not in edge:
                continue
            other = edge[0] if edge[1] == label else edge[1]
            if other not in allowed_neighbors:
                inferred_edges.discard(edge)
        for other in allowed_neighbors:
            inferred_edges.add(tuple(sorted((label, other))))

    connections = []
    for order, (from_name, to_name) in enumerate(sorted(inferred_edges)):
        from_node = nodes_by_label.get(from_name)
        to_node = nodes_by_label.get(to_name)
        from_details = map_details_by_name.get(from_name)
        to_details = map_details_by_name.get(to_name)
        validation = VALIDATED_CONNECTIONS.get((from_name, to_name))
        is_bridge = (from_name, to_name) in {tuple(sorted(edge)) for edge in BRIDGE_EDGES}

        connections.append(
            {
                "order": order,
                "fromMapName": from_name,
                "fromMapId": from_details["mapId"] if from_details else None,
                "fromNodeName": from_node["name"] if from_node else None,
                "fromNodeId": from_node["nodeId"] if from_node else None,
                "toMapName": to_name,
                "toMapId": to_details["mapId"] if to_details else None,
                "toNodeName": to_node["name"] if to_node else None,
                "toNodeId": to_node["nodeId"] if to_node else None,
                "worldMapEdge": {
                    "from": {
                        "x": from_node["x"] if from_node else None,
                        "y": from_node["y"] if from_node else None,
                    },
                    "to": {
                        "x": to_node["x"] if to_node else None,
                        "y": to_node["y"] if to_node else None,
                    },
                },
                "connectionType": "bridge" if is_bridge else "local-neighbor",
                "validation": validation["validation"] if validation else "ui-inferred",
                "authority": "presentation-only",
                "notes": (
                    validation["notes"]
                    if validation
                    else (
                        "Component bridge added to keep the inferred world-map graph connected."
                        if is_bridge
                        else "Inferred from world-map node geometry using mutual-nearest-neighbor heuristics."
                    )
                ),
            }
        )

    return {
        "source": {
            "worldmapNodes": str(WORLDMAP_NODES_PATH),
            "mapDetailsDir": str(MAP_DETAILS_DIR),
            "generator": "scripts/generate-worldmap-connections.py",
        },
        "summary": {
            "connectionCount": len(connections),
            "authoritativeForTeleportRouting": False,
            "localNeighborThreshold": LOCAL_NEIGHBOR_THRESHOLD,
            "localNeighborLimit": LOCAL_NEIGHBOR_LIMIT,
            "bridgeEdgeCount": len(BRIDGE_EDGES),
        },
        "connections": connections,
    }


def main() -> None:
    output = build_connections()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(OUTPUT_PATH)
    print(output["summary"]["connectionCount"])


if __name__ == "__main__":
    main()
