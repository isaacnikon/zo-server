#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path

QUEST_SCHEMA_FILE = Path(__file__).resolve().parent.parent / "data" / "client-derived" / "quest-schema.json"
TASK_STATE_FILE = Path(__file__).resolve().parent.parent / "data" / "client-derived" / "task-state-clusters.json"
TASK_MATCHES_FILE = Path(__file__).resolve().parent.parent / "data" / "client-derived" / "task-state-matches.json"
OUTPUT_FILE = Path(__file__).resolve().parent.parent / "data" / "client-derived" / "task-chains.json"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf8"))


def cluster_family_id(raw_snippet: str) -> str:
    return hashlib.sha1(raw_snippet.encode("utf8")).hexdigest()[:12]


def build_chains(schema: dict, clusters_doc: dict, matches_doc: dict) -> list[dict]:
    clusters_by_id = {cluster["clusterIndex"]: cluster for cluster in clusters_doc.get("clusters", [])}
    family_members: dict[str, list[int]] = {}
    for cluster in clusters_doc.get("clusters", []):
      family_members.setdefault(cluster_family_id(cluster["rawSnippet"]), []).append(cluster["clusterIndex"])

    match_by_task = {entry["taskId"]: entry for entry in matches_doc.get("matches", [])}
    chains: list[dict] = []

    for quest in schema.get("quests", []):
        task_id = quest["taskId"]
        task_match = match_by_task.get(task_id, {"stepMatches": []})
        canonical_steps = []
        unresolved_steps = []

        for step_match in task_match.get("stepMatches", []):
            candidates = step_match.get("topCandidates", [])
            if not candidates:
                unresolved_steps.append(step_match["stepIndex"])
                continue
            best = candidates[0]
            cluster = clusters_by_id.get(best["clusterIndex"])
            if not cluster:
                unresolved_steps.append(step_match["stepIndex"])
                continue
            family_id = cluster_family_id(cluster["rawSnippet"])
            canonical_steps.append({
                "stepIndex": step_match["stepIndex"],
                "type": step_match.get("type"),
                "matchedClusterIndex": cluster["clusterIndex"],
                "clusterFamilyId": family_id,
                "familyMembers": family_members.get(family_id, []),
                "score": best["score"],
                "reasons": best["reasons"],
                "state": {
                    "maxStep": cluster.get("maxStep"),
                    "taskType": cluster.get("taskType"),
                    "overNpcId": cluster.get("overNpcId"),
                    "taskStep": cluster.get("taskStep"),
                    "itemParams": cluster.get("itemParams", []),
                    "killParams": cluster.get("killParams", []),
                    "addedItems": cluster.get("addedItems", []),
                    "dropRate": cluster.get("dropRate"),
                },
            })

        chains.append({
            "taskId": task_id,
            "title": quest.get("title"),
            "stepCount": len(quest.get("steps", [])),
            "resolvedStepCount": len(canonical_steps),
            "unresolvedSteps": unresolved_steps,
            "canonicalSteps": canonical_steps,
        })

    return chains


def main() -> int:
    schema = load_json(QUEST_SCHEMA_FILE)
    clusters = load_json(TASK_STATE_FILE)
    matches = load_json(TASK_MATCHES_FILE)
    chains = build_chains(schema, clusters, matches)
    OUTPUT_FILE.write_text(
        json.dumps(
            {
                "source": {
                    "questSchema": str(QUEST_SCHEMA_FILE),
                    "taskState": str(TASK_STATE_FILE),
                    "taskMatches": str(TASK_MATCHES_FILE),
                },
                "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
                "chainCount": len(chains),
                "chains": chains,
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
