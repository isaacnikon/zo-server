#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
import re
import sys

DEFAULT_SCRIPT_GCG = Path("/home/nikon/Data/Zodiac Online/gcg/script.gcg")
OUTPUT_FILE = Path(__file__).resolve().parent.parent / "data" / "client-derived" / "task-state-clusters.json"


def extract_single_number(text: str, pattern: str) -> int | None:
    match = re.search(pattern, text)
    return int(match.group(1)) if match else None


def extract_task_state_clusters(lines: list[str]) -> list[dict]:
    clusters: list[dict] = []

    for index, line in enumerate(lines):
        if "macro_SetTaskMaxStep(" not in line:
            continue

        start = index
        end = index
        saw_step = False

        for inner in range(index, min(len(lines), index + 20)):
            current = lines[inner]
            end = inner
            if "macro_SetTaskStep(" in current:
                saw_step = True
                break
            if inner > index and (
                "macro_SetTaskFinished(" in current
                or "award = macro_GetSelectAward()" in current
                or "task_addid={" in current
                or "task_talkid={" in current
                or "task_awardid={" in current
            ):
                break

        if not saw_step:
            continue

        snippet_lines = lines[start : end + 1]
        raw_snippet = "\n".join(snippet_lines)

        clusters.append(
            {
                "clusterIndex": len(clusters) + 1,
                "lineStart": start + 1,
                "lineEnd": end + 1,
                "maxStep": extract_single_number(raw_snippet, r"macro_SetTaskMaxStep\((\d+)\)"),
                "taskType": extract_single_number(raw_snippet, r"macro_SetTaskType\((\d+)\)"),
                "overNpcId": extract_single_number(raw_snippet, r"macro_SetOverNpc\((\d+)\)"),
                "maxAward": extract_single_number(raw_snippet, r"macro_SetMaxAward\((\d+)\)"),
                "taskStep": extract_single_number(raw_snippet, r"macro_SetTaskStep\((\d+)\)"),
                "itemParams": [
                    {
                        "templateId": int(match.group(1)),
                        "count": int(match.group(2)),
                        "index": int(match.group(3)),
                    }
                    for match in re.finditer(r"macro_SetTaskItemParam\((\d+),(\d+),(\d+)\)", raw_snippet)
                ],
                "killParams": [
                    {
                        "monsterId": int(match.group(1)),
                        "count": int(match.group(2)),
                        "index": int(match.group(3)),
                    }
                    for match in re.finditer(r"macro_SetTaskKillParam\((\d+),(\d+),(\d+)\)", raw_snippet)
                ],
                "addedItems": [
                    {
                        "templateId": int(match.group(1)),
                        "quantity": int(match.group(2)),
                    }
                    for match in re.finditer(r"macro_AddItem(?:BangDing)?\((\d+),(\d+),0\)", raw_snippet)
                ],
                "dropRate": extract_single_number(raw_snippet, r"macro_SetTaskDropRate\((\d+)\)"),
                "rawSnippet": raw_snippet,
            }
        )

    return clusters


def main() -> int:
    script_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SCRIPT_GCG
    content = script_path.read_text(encoding="latin1")
    lines = content.splitlines()
    clusters = extract_task_state_clusters(lines)

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(
        json.dumps(
            {
                "source": {"script": str(script_path)},
                "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
                "clusterCount": len(clusters),
                "clusters": clusters,
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
