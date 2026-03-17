#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

QUEST_SCHEMA_FILE = Path(__file__).resolve().parent.parent / "data" / "client-derived" / "quest-schema.json"
TASK_STATE_FILE = Path(__file__).resolve().parent.parent / "data" / "client-derived" / "task-state-clusters.json"
OUTPUT_FILE = Path(__file__).resolve().parent.parent / "data" / "client-derived" / "task-state-matches.json"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf8"))


def score_cluster(step: dict, quest: dict, cluster: dict) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []

    if cluster.get("maxStep") == len(quest.get("steps", [])):
      score += 2
      reasons.append("maxStep")

    if cluster.get("taskStep") == step.get("stepIndex"):
      score += 3
      reasons.append("stepIndex")

    if cluster.get("overNpcId") == step.get("npcId"):
      score += 4
      reasons.append("npc")

    if step.get("type") == "kill":
      for kill in cluster.get("killParams", []):
        if kill.get("monsterId") == step.get("monsterId"):
          score += 6
          reasons.append("monster")
        if kill.get("count") == step.get("count"):
          score += 2
          reasons.append("killCount")

    consume_items = step.get("consumeItems", []) or []
    for item in consume_items:
      for param in cluster.get("itemParams", []):
        if param.get("templateId") == item.get("templateId"):
          score += 6
          reasons.append("itemParam")
        if param.get("count") == item.get("quantity"):
          score += 2
          reasons.append("itemCount")
      for added in cluster.get("addedItems", []):
        if added.get("templateId") == item.get("templateId"):
          score += 4
          reasons.append("addedItem")

    if step.get("type") == "kill_collect":
      for kill in cluster.get("killParams", []):
        if kill.get("count") == step.get("count"):
          score += 2
          reasons.append("collectCount")
      if cluster.get("overNpcId") == step.get("npcId"):
        score += 2
        reasons.append("collectNpc")

    return score, reasons


def build_matches(schema: dict, state_clusters: dict) -> list[dict]:
    matches: list[dict] = []
    clusters = state_clusters.get("clusters", [])

    for quest in schema.get("quests", []):
        quest_steps = quest.get("steps", []) or []
        step_matches = []
        for step in quest_steps:
            candidates = []
            for cluster in clusters:
                score, reasons = score_cluster(step, quest, cluster)
                if score <= 0:
                    continue
                candidates.append({
                    "clusterIndex": cluster.get("clusterIndex"),
                    "score": score,
                    "reasons": reasons,
                    "lineStart": cluster.get("lineStart"),
                    "lineEnd": cluster.get("lineEnd"),
                    "maxStep": cluster.get("maxStep"),
                    "taskStep": cluster.get("taskStep"),
                    "taskType": cluster.get("taskType"),
                    "overNpcId": cluster.get("overNpcId"),
                    "itemParams": cluster.get("itemParams"),
                    "killParams": cluster.get("killParams"),
                    "addedItems": cluster.get("addedItems"),
                })
            candidates.sort(key=lambda entry: (-entry["score"], entry["clusterIndex"]))
            step_matches.append({
                "stepIndex": step.get("stepIndex"),
                "type": step.get("type"),
                "npcId": step.get("npcId"),
                "monsterId": step.get("monsterId"),
                "consumeItems": step.get("consumeItems"),
                "topCandidates": candidates[:5],
            })
        matches.append({
            "taskId": quest.get("taskId"),
            "title": quest.get("title"),
            "stepMatches": step_matches,
        })
    return matches


def main() -> int:
    schema = load_json(QUEST_SCHEMA_FILE)
    state_clusters = load_json(TASK_STATE_FILE)
    matches = build_matches(schema, state_clusters)
    OUTPUT_FILE.write_text(
        json.dumps({
            "source": {
                "questSchema": str(QUEST_SCHEMA_FILE),
                "taskState": str(TASK_STATE_FILE),
            },
            "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            "matchCount": len(matches),
            "matches": matches,
        }, indent=2) + "\n",
        encoding="utf8",
    )
    print(OUTPUT_FILE)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
