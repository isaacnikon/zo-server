#!/usr/bin/env python3
"""Extend client-help-quests.json from 56 to all quest help pages in script.gcg.

Each quest help page block in the Lua scripts has the pattern:
  --QuestName(step), NpcName, Lvl.N
  map,x,y=macro_GetNpcPosition(npcId, mapId)
  ...
  macro_GuiSetText("helpcontext", "...macro_GetTaskName(taskId)..(stepIndex)...content...")
  macro_GuiSetTextCurrentP("helpcontext")
  macro_GuiSetWinVisable("HELPWIN", 1)
  --NextQuestName...

The blockPreview in the existing file captures from the comment through the next comment.
This script replicates that extraction for all quest blocks.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_GCG = Path("/home/nikon/Data/Zodiac Online/gcg/script.gcg")
OUTPUT_FILE = Path(__file__).resolve().parent.parent.parent / "data" / "client-verified" / "quests" / "client-help-quests.json"

# ── Regex patterns ─────────────────────────────────────────────────────────────

# A quest help comment: starts with -- followed by a title with optional (N) step suffix
# Then optional NPC names, Lvl.N etc.
QUEST_COMMENT_RE = re.compile(
    r'--([^\n]{3,120}?Lvl\.[0-9][^\n]*)\n',
)

# Simpler: any -- comment that precedes a macro_GetNpcPosition or macro_GuiSetText("helpcontext"
# We'll find all comment+helpcontext block pairs instead.

# Find macro_GetNpcPosition(npcId, mapId)
NPC_POS_RE = re.compile(r'macro_GetNpcPosition\((\d+),(\d+)\)')

# Find macro_GetTaskName(N)
TASK_NAME_RE = re.compile(r'macro_GetTaskName\((\d+)\)')

# Find macro_GetItemName(N)
ITEM_NAME_RE = re.compile(r'macro_GetItemName\((\d+)\)')

# Find macro_GetTypeNpcName(N)
TYPE_NPC_RE = re.compile(r'macro_GetTypeNpcName\((\d+)\)')

# Find the step index: ..macro_GetTaskName(N).."(step)" or ..macro_GetTaskName(N).."(1)
STEP_INDEX_RE = re.compile(r'macro_GetTaskName\(\d+\)\.\."?\((\d+)\)"?')

# Quest goal text: "Quest Goal: ..." up to \n or Quest Reward/Brief/Description
GOAL_RE = re.compile(
    r'Quest Goal:\s*(.*?)(?=\\n(?:Quest Reward|Quest Brief|Quest Description|#0|$))',
    re.DOTALL,
)

# Quest brief / description text
BRIEF_RE = re.compile(
    r'Quest (?:Brief|Description):\s*(.*?)(?=\\n\\n|\\n#2|\\n#0<8>|$)',
    re.DOTALL,
)

# Quest level: "Quest Level:N" or "Quest Level: N Level"
LEVEL_RE = re.compile(r'Quest Level[:\s]+(\d+)')

# Title from comment: --TitleName(step), NpcName, Lvl.N
# or: --TitleName, NpcName, Lvl.N
COMMENT_TITLE_RE = re.compile(r'^--([^,\(]+?)(?:\(\d+\))?\s*,')

# Color tags to strip for clean text
COLOR_RE = re.compile(r'#0<\d+>')
GBK_RE = re.compile(r'[\xa1-\xfe][\xa1-\xfe]')


def strip_color(s: str) -> str:
    s = COLOR_RE.sub('', s)
    s = GBK_RE.sub('', s)
    return s.strip()


def extract_static_text(lua_str: str) -> str:
    """Extract static string portions from a Lua string expression."""
    # Remove macro calls, keeping surrounding text
    s = lua_str
    s = re.sub(r'\.\.\s*macro_\w+\([^)]*\)\s*\.\.', '..', s)
    s = re.sub(r'"\s*\.\.\s*macro_\w+\([^)]*\)\s*\.\.\s*"', '', s)
    s = re.sub(r'macro_\w+\([^)]*\)', '', s)
    s = re.sub(r'"\s*\.\.\s*"', '', s)
    s = re.sub(r'"\s*\.\.\s*', '"', s)
    return s


def parse_block(comment_line: str, block: str) -> dict | None:
    """Parse a single Lua quest help block and return structured data or None."""

    # Must contain macro_GetTaskName to be a quest page (not a system help page)
    task_ids_found = [int(m) for m in TASK_NAME_RE.findall(block)]
    if not task_ids_found:
        return None

    # Primary taskId is the first one found in the helpcontext string
    # Find the helpcontext content
    ctx_match = re.search(r'macro_GuiSetText\("helpcontext",\s*(.*?)(?=\)\s*\n)', block, re.DOTALL)
    if not ctx_match:
        return None
    ctx = ctx_match.group(1)

    # taskId from first GetTaskName in the helpcontext expression
    ctx_task_ids = [int(m) for m in TASK_NAME_RE.findall(ctx)]
    if not ctx_task_ids:
        return None
    task_id = ctx_task_ids[0]

    # stepIndex from the "(N)" suffix after the first task name in the helpcontext
    step_match = STEP_INDEX_RE.search(ctx)
    step_index = int(step_match.group(1)) if step_match else 1

    # NPC positions (from the preamble before helpcontext)
    preamble = block[:ctx_match.start()]
    npc_positions = NPC_POS_RE.findall(preamble)
    start_npc_ids = [int(n) for n, _ in npc_positions]
    map_ids = [int(m) for _, m in npc_positions]

    # Also grab any npcPos calls within the helpcontext string itself
    ctx_npc_pos = NPC_POS_RE.findall(ctx)
    for npc_id, map_id in ctx_npc_pos:
        npc_id, map_id = int(npc_id), int(map_id)
        if npc_id not in start_npc_ids:
            start_npc_ids.append(npc_id)
        if map_id not in map_ids:
            map_ids.append(map_id)

    # itemIds from GetItemName calls in helpcontext
    item_ids = list(dict.fromkeys(int(m) for m in ITEM_NAME_RE.findall(ctx)))

    # targetNpcIds from GetTypeNpcName calls in helpcontext kill-quest goals
    # These appear in "Quest Goal: Kill ...GetTypeNpcName(N)..." patterns
    goal_section_match = re.search(r'Quest Goal:(.*?)(?=Quest Reward|Quest Brief|Quest Description|\\n\\n)', ctx, re.DOTALL)
    target_npc_ids: list[int] = []
    if goal_section_match:
        goal_section = goal_section_match.group(1)
        target_npc_ids = list(dict.fromkeys(int(m) for m in TYPE_NPC_RE.findall(goal_section)))

    # referencedTaskIds: GetTaskName calls that are NOT the primary taskId
    referenced_task_ids = list(dict.fromkeys(
        t for t in ctx_task_ids[1:] if t != task_id
    ))

    # goalCount: number of Quest Goal: sections in the block
    goal_count = max(1, len(re.findall(r'Quest Goal:', ctx)))

    # Extract static text for goal and brief
    goal_text = ''
    goal_m = GOAL_RE.search(ctx)
    if goal_m:
        goal_text = strip_color(extract_static_text(goal_m.group(1))).replace('\\n', ' ').strip()

    brief_text = ''
    brief_m = BRIEF_RE.search(ctx)
    if brief_m:
        brief_text = strip_color(extract_static_text(brief_m.group(1))).replace('\\n', ' ').strip()

    # Quest level from context
    level_m = LEVEL_RE.search(ctx)
    quest_level = int(level_m.group(1)) if level_m else 0

    # Title from comment line
    title = ''
    comment_title_m = COMMENT_TITLE_RE.match(comment_line)
    if comment_title_m:
        raw = comment_title_m.group(1).strip()
        # Remove step suffixes like (I), (II), (III), etc.
        title = re.sub(r'\s*\([IVX]+\)\s*$', '', raw).strip()
        title = re.sub(r'\s*\(\d+\)\s*$', '', title).strip()
    if not title:
        title = f'Quest {task_id}'

    return {
        'taskId': task_id,
        'title': title,
        'helpVariantTitle': title,
        'stepIndex': step_index,
        'questLevel': quest_level,
        'startNpcIds': start_npc_ids,
        'mapIds': map_ids,
        'targetNpcIds': target_npc_ids,
        'itemIds': item_ids,
        'goalCount': goal_count,
        'referencedTaskIds': referenced_task_ids,
        'goalText': goal_text,
        'briefText': brief_text,
        'blockPreview': '',  # filled in below
    }


def find_all_quest_blocks(text: str) -> list[dict]:
    """Find all quest help page blocks in the Lua text."""

    # The pattern: macro_GuiSetWinVisable("HELPWIN", 1) followed by --Comment\n
    # Each block runs from one comment to the start of the next comment.
    #
    # We find all HELPWIN+comment positions, then slice blocks between them.

    HELPWIN_COMMENT_RE = re.compile(
        r'macro_GuiSetWinVisable\("HELPWIN",\s*1\)\s*\r?\n'
        r'(--.+)',
        re.MULTILINE,
    )

    # Find all (position, comment_text) pairs
    markers: list[tuple[int, str]] = []
    for m in HELPWIN_COMMENT_RE.finditer(text):
        comment_text = m.group(1)
        # Only include quest-style comments (have Lvl. or are NPC quest style)
        markers.append((m.start(), comment_text))

    print(f'  Found {len(markers)} HELPWIN+comment markers')

    results: list[dict] = []
    for i, (start_pos, comment_line) in enumerate(markers):
        # Block ends at the start of the next marker (or 5000 chars max)
        if i + 1 < len(markers):
            end_pos = markers[i + 1][0]
        else:
            end_pos = start_pos + 5000

        block = text[start_pos:end_pos]

        entry = parse_block(comment_line, block)
        if entry is None:
            continue

        # Build blockPreview: from the comment line to (and including) the next comment line
        # This matches the format of the existing hand-curated entries
        comment_start = block.find(comment_line)
        if comment_start < 0:
            continue
        preview_text = block[comment_start:]
        # Normalize CRLF → LF
        preview_text = preview_text.replace('\r\n', '\n')
        # Truncate at next comment (include the next comment line as the existing format does)
        next_comment = re.search(r'\n--', preview_text[1:])
        if next_comment:
            preview_text = preview_text[:next_comment.start() + 1 + len('\n--') +
                                        len(preview_text[next_comment.start() + 2:].split('\n')[0])]

        entry['blockPreview'] = preview_text.strip()
        results.append(entry)

    return results


def deduplicate(entries: list[dict]) -> list[dict]:
    """Deduplicate by (taskId, stepIndex), keeping the richer entry."""
    seen: dict[tuple[int, int], dict] = {}
    for entry in entries:
        key = (entry['taskId'], entry['stepIndex'])
        if key not in seen:
            seen[key] = entry
        else:
            existing = seen[key]
            # Keep the one with more NPC data / richer content
            if len(entry.get('startNpcIds', [])) > len(existing.get('startNpcIds', [])):
                seen[key] = entry
            elif len(entry.get('briefText', '')) > len(existing.get('briefText', '')):
                seen[key] = entry
    return sorted(seen.values(), key=lambda e: (e['taskId'], e['stepIndex']))


def main() -> None:
    print(f'Reading {SCRIPT_GCG} ...')
    data = SCRIPT_GCG.read_bytes()
    text = data.decode('latin-1')
    print(f'  {len(data):,} bytes')

    print('Extracting quest help blocks ...')
    entries = find_all_quest_blocks(text)
    print(f'  {len(entries)} raw blocks extracted')

    entries = deduplicate(entries)
    print(f'  {len(entries)} unique (taskId, stepIndex) entries')

    # Load existing file to check what we're replacing
    existing_count = 0
    if OUTPUT_FILE.exists():
        try:
            existing = json.loads(OUTPUT_FILE.read_text(encoding='utf-8'))
            existing_count = existing.get('questCount', 0)
            print(f'  Replacing {existing_count} existing entries')
        except Exception:
            pass

    output = {
        'source': str(SCRIPT_GCG),
        'extractedAt': datetime.now(timezone.utc).isoformat(),
        'questCount': len(entries),
        'previousQuestCount': existing_count,
        'quests': entries,
    }

    OUTPUT_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'\nWrote {len(entries)} entries → {OUTPUT_FILE}')

    # Stats
    with_brief = sum(1 for e in entries if e.get('briefText'))
    with_goal = sum(1 for e in entries if e.get('goalText'))
    unique_tasks = len({e['taskId'] for e in entries})
    print(f'  Unique quests: {unique_tasks}')
    print(f'  With goal text: {with_goal}')
    print(f'  With brief text: {with_brief}')


if __name__ == '__main__':
    main()
