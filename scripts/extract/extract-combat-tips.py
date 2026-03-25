#!/usr/bin/env python3
"""Extract battle loading tips from guides/combat-tips.md into data/client-verified/combat-tips.json.

Source format (guides/combat-tips.md):
  **Tip 0:** TipClick on the [auto] icon...
  **Tip 1:** ...

Each tip starts with '**Tip N:** ' prefix. The 'Tip' prefix sometimes appears as
literal text inside the tip (e.g. "TipClick") — that is client data and is preserved.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SOURCE_FILE = REPO_ROOT / 'guides' / 'combat-tips.md'
OUTPUT_FILE = REPO_ROOT / 'data' / 'client-verified' / 'combat-tips.json'

TIP_RE = re.compile(r'^\*\*Tip \d+:\*\*\s*(.+)$')


def main() -> None:
    lines = SOURCE_FILE.read_text(encoding='utf-8').splitlines()
    tips: list[str] = []
    for line in lines:
        m = TIP_RE.match(line.strip())
        if m:
            tip = m.group(1).strip()
            # Strip a leading literal "Tip" prefix that the client data includes
            if tip.startswith('Tip'):
                tip = tip[3:].lstrip()
            if tip:
                tips.append(tip)

    output = {
        'extractedAt': datetime.now(timezone.utc).isoformat(),
        'tipCount': len(tips),
        'tips': tips,
    }
    OUTPUT_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Extracted {len(tips)} combat tips → {OUTPUT_FILE}')


if __name__ == '__main__':
    main()
