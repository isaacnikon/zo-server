#!/usr/bin/env python3
"""Populate acceptMessage in main-story.json with briefText from client-help-quests.json.

Each quest's step-1 briefText contains the real lore intro shown when the quest is
accepted. This replaces generic placeholder messages like "Back to Earth is active."
with the actual text extracted from the client guide.

Only quests where the current acceptMessage looks generic (ends with " is active." or
is empty) are updated. Quests with hand-written acceptMessages are left unchanged.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
HELP_QUESTS_FILE = REPO_ROOT / 'data' / 'client-verified' / 'quests' / 'client-help-quests.json'
MAIN_STORY_FILE = REPO_ROOT / 'data' / 'quests' / 'main-story.json'

# Pattern that identifies a generic auto-generated accept message
GENERIC_ACCEPT_RE = re.compile(r'^.{1,80} is active\.$')


def is_generic_message(msg: str) -> bool:
    return not msg or GENERIC_ACCEPT_RE.match(msg) is not None


def build_brief_map(help_data: dict) -> dict[int, str]:
    """Build taskId → briefText map from step-1 entries."""
    brief_map: dict[int, str] = {}
    for entry in help_data.get('quests', []):
        task_id = entry.get('taskId')
        step_index = entry.get('stepIndex', 1)
        brief = entry.get('briefText', '').strip()
        if not isinstance(task_id, int) or not brief:
            continue
        # Prefer step 1 (the quest intro); only overwrite if not already set
        if step_index == 1 or task_id not in brief_map:
            brief_map[task_id] = brief
    return brief_map


def main() -> None:
    help_data = json.loads(HELP_QUESTS_FILE.read_text(encoding='utf-8'))
    story_data = json.loads(MAIN_STORY_FILE.read_text(encoding='utf-8'))

    brief_map = build_brief_map(help_data)
    print(f'Loaded {len(brief_map)} briefText entries from client-help-quests.json')

    quests = story_data.get('quests', [])
    updated = 0
    skipped_custom = 0
    skipped_no_brief = 0

    for quest in quests:
        task_id = quest.get('id')
        current_msg = quest.get('acceptMessage', '')

        if not is_generic_message(current_msg):
            skipped_custom += 1
            continue

        brief = brief_map.get(task_id)
        if not brief:
            skipped_no_brief += 1
            continue

        quest['acceptMessage'] = brief
        updated += 1

    print(f'Updated {updated} quest accept messages')
    print(f'Skipped {skipped_custom} with custom messages, {skipped_no_brief} with no brief text')

    MAIN_STORY_FILE.write_text(
        json.dumps(story_data, indent=2, ensure_ascii=False) + '\n',
        encoding='utf-8'
    )
    print(f'Wrote {MAIN_STORY_FILE}')


if __name__ == '__main__':
    main()
