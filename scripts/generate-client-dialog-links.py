#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path

QUEST_SCHEMA_FILE = Path(__file__).resolve().parent.parent / "data" / "client-derived" / "quest-schema.json"
TASK_RUNTIME_FILE = Path(__file__).resolve().parent.parent / "data" / "client-derived" / "task-runtime.json"
TASK_STATE_FILE = Path(__file__).resolve().parent.parent / "data" / "client-derived" / "task-state-clusters.json"
TASK_CHAINS_FILE = Path(__file__).resolve().parent.parent / "data" / "client-derived" / "task-chains.json"
OUTPUT_FILE = Path(__file__).resolve().parent.parent / "data" / "client-derived" / "dialog-links.json"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf8"))


def family_id(raw_snippet: str) -> str:
    return hashlib.sha1(raw_snippet.encode("utf8")).hexdigest()[:12]


def nearby_clusters(task_tables: list[dict], clusters: list[dict], window: int = 120) -> list[dict]:
    by_line = []
    for block in task_tables:
        block_line = block["lineStart"]
        nearby = []
        for cluster in clusters:
            delta = abs(cluster["lineStart"] - block_line)
            if delta <= window:
                nearby.append({
                    "clusterIndex": cluster["clusterIndex"],
                    "lineStart": cluster["lineStart"],
                    "lineEnd": cluster["lineEnd"],
                    "deltaLines": delta,
                    "clusterFamilyId": family_id(cluster["rawSnippet"]),
                    "taskStep": cluster.get("taskStep"),
                    "taskType": cluster.get("taskType"),
                    "overNpcId": cluster.get("overNpcId"),
                })
        nearby.sort(key=lambda entry: (entry["deltaLines"], entry["clusterIndex"]))
        by_line.append((block, nearby[:10]))
    return by_line


def build_links(schema: dict, runtime: dict, state_clusters: dict, chains: dict) -> list[dict]:
    chains_by_task = {entry["taskId"]: entry for entry in chains.get("chains", [])}
    all_clusters = state_clusters.get("clusters", [])
    links = []

    for quest in schema.get("quests", []):
        task_id = quest["taskId"]
        relevant_blocks = []
        for block in runtime.get("taskTableBlocks", []):
            add = [entry for entry in block.get("taskAddEntries", []) if entry.get("taskId") == task_id]
            talk = [entry for entry in block.get("taskTalkEntries", []) if entry.get("taskId") == task_id]
            award = [entry for entry in block.get("taskAwardEntries", []) if entry.get("taskId") == task_id]
            if add or talk or award:
                relevant_blocks.append({
                    "lineStart": block["lineStart"],
                    "lineEnd": block["lineEnd"],
                    "fileExecReferences": block.get("fileExecReferences", []),
                    "taskAddEntries": add,
                    "taskTalkEntries": talk,
                    "taskAwardEntries": award,
                })

        linked_blocks = []
        for block, nearby in nearby_clusters(relevant_blocks, all_clusters):
            linked_blocks.append({
                **block,
                "nearbyClusters": nearby,
            })

        links.append({
            "taskId": task_id,
            "title": quest.get("title"),
            "canonicalChain": chains_by_task.get(task_id, {}).get("canonicalSteps", []),
            "dialogBlocks": linked_blocks,
        })

    return links


def main() -> int:
    schema = load_json(QUEST_SCHEMA_FILE)
    runtime = load_json(TASK_RUNTIME_FILE)
    state_clusters = load_json(TASK_STATE_FILE)
    chains = load_json(TASK_CHAINS_FILE)
    links = build_links(schema, runtime, state_clusters, chains)
    OUTPUT_FILE.write_text(
        json.dumps(
            {
                "source": {
                    "questSchema": str(QUEST_SCHEMA_FILE),
                    "taskRuntime": str(TASK_RUNTIME_FILE),
                    "taskState": str(TASK_STATE_FILE),
                    "taskChains": str(TASK_CHAINS_FILE),
                },
                "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
                "linkCount": len(links),
                "links": links,
            },
            indent=2,
        )
        + "\n",
        encoding="utf8",
    )
    print(OUTPUT_FILE)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
