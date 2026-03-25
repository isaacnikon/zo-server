#!/usr/bin/env python3
"""Extract in-game help guide content from script.gcg Lua scripts.

The script.gcg archive contains Lua scripts. Help pages are rendered via:
  macro_GuiSetText("helpcontext", "...content...")
  macro_GuiSetTextCurrentP("helpcontext")

Each such call is a help page. Comments like --Back to Earth(1) identify the page.
The help catalog (IDs + titles) is built via claver strings with #2<N><ID><0>Title patterns.
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

SCRIPT_GCG = Path("/home/nikon/Data/Zodiac Online/gcg/script.gcg")
OUTPUT_DIR = Path(__file__).resolve().parent.parent.parent / "guides"

# Category names for the help system
CATEGORY_NAMES: dict[str, str] = {
    "100": "newbie-guide",
    "110": "combat-tips",
    "200": "quest-index",
    "300": "misc",
    "400": "system-help",
    "401": "system-help-advanced",
}
# Main story quest chapters (201-257)
for _n in range(201, 258):
    if _n != 237:
        CATEGORY_NAMES[str(_n)] = f"main-quest-ch{_n - 200:02d}"


# ── Text cleaning helpers ─────────────────────────────────────────────────────

COLOR_RE = re.compile(r'#[02]?<\d+>')
GBK_PAIR_RE = re.compile(r'[\xa1-\xfe][\xa1-\xfe]')
GBK_LONE_RE = re.compile(r'[\xa1-\xfe]')


def clean_text(raw: str) -> str:
    """Strip Lua/client formatting tags from help text."""
    t = COLOR_RE.sub('', raw)
    t = GBK_PAIR_RE.sub('', t)      # remove GBK Chinese chars (decorative)
    t = GBK_LONE_RE.sub('', t)      # remove lone GBK lead bytes
    t = t.replace('\\n', '\n')
    t = t.replace('\\t', '  ')
    # Remove link IDs that remain after stripping color tags: <123456><0>
    t = re.sub(r'<\d{5,6}><0>', '', t)
    t = re.sub(r'<\d+><\d+>', '', t)
    # Collapse excessive blank lines
    t = re.sub(r'\n{4,}', '\n\n\n', t)
    t = re.sub(r'[ \t]+$', '', t, flags=re.MULTILINE)
    return t.strip()


MACRO_SUBS = [
    (re.compile(r'macro_GetTaskName\((\d+)\)'), r'[Quest #\1]'),
    (re.compile(r'macro_GetItemName\((\d+)\)'), r'[Item #\1]'),
    (re.compile(r'macro_GetTypeNpcName\((\d+)\)'), r'[NPC #\1]'),
    (re.compile(r'macro_GetMapName\((\d+)\)'), r'[Map #\1]'),
    (re.compile(r'macro_\w+\([^)]*\)'), r'[game_data]'),
    (re.compile(r'\.\.[xy][01]?\b'), ''),   # coordinate variable refs
]


def lua_str_to_text(lua_expr: str) -> str:
    """Convert a Lua string expression (possibly with ..concat) to plain text."""
    s = lua_expr.strip()
    for pattern, repl in MACRO_SUBS:
        s = pattern.sub(repl, s)
    # Join concatenated string literals: "a".."b" → "ab"
    s = re.sub(r'"\s*\.\.\s*"', '', s)
    s = re.sub(r'"\s*\.\.\s*\[', '"[', s)
    s = re.sub(r'\]\s*\.\.\s*"', ']"', s)
    # Strip outer quotes
    if s.startswith('"'):
        s = s[1:]
    if s.endswith('"'):
        s = s[:-1]
    return s


# ── Help page extraction ──────────────────────────────────────────────────────

# Pattern: HELPWIN shown, optional comment, then GuiSetText("helpcontext", ...)
HELPPAGE_RE = re.compile(
    r'macro_GuiSetWinVisable\("HELPWIN",\s*1\)\s*\r?\n'
    r'(?:--([^\r\n]*)\r?\n)?'           # optional comment → group 1
    r'((?:[^\r\n]*\r?\n){0,8}?)'        # optional preamble (NPC lookups etc) → group 2
    r'macro_GuiSetText\("helpcontext",\s*'
    r'(.*?)'                            # content expression → group 3
    r'(?=\)\s*\r?\n)',                  # stop before closing paren + newline
    re.DOTALL,
)

# Alternative: claver-based pages (catalog index pages and system pages)
CLAVER_PAGE_RE = re.compile(
    r'macro_GuiSetText\("helpcontext",\s*claver\)\s*\r?\n'
    r'macro_GuiSetTextCurrentP\("helpcontext"\)',
)

# Catalog link pattern: #2<N><ID><0>Title
CATALOG_LINK_RE = re.compile(r'#2<\d+><(\d{5,6})><0>([^\\"\n<]{2,80}?)(?=\\n|[<"\n])')


def extract_help_pages(text: str) -> list[dict]:
    """Extract all help pages from the full Lua text.

    Returns list of dicts with keys: comment, content_raw, content_text, pos
    """
    pages = []
    for m in HELPPAGE_RE.finditer(text):
        comment = (m.group(1) or '').strip()
        raw = m.group(3)
        content_text = lua_str_to_text(raw)
        cleaned = clean_text(content_text)
        if len(cleaned) > 15:   # skip trivially empty pages
            pages.append({
                'comment': comment,
                'content_text': cleaned,
                'pos': m.start(),
            })
    return pages


def extract_catalog(text: str) -> dict[str, list[dict]]:
    """Extract the help catalog: map of category → list of {id, title}."""
    catalog: dict[str, list[dict]] = defaultdict(list)
    seen: set[str] = set()
    for m in CATALOG_LINK_RE.finditer(text):
        page_id = m.group(1)
        title_raw = m.group(2).strip()
        title = GBK_PAIR_RE.sub('', title_raw)
        title = GBK_LONE_RE.sub('', title).strip()
        if not title or page_id in seen:
            continue
        seen.add(page_id)
        cat = page_id[:3]
        catalog[cat].append({'id': page_id, 'title': title})
    return dict(catalog)


def extract_claver_pages(text: str) -> list[dict]:
    """Extract pages built via claver = "..." + claver = claver.."..." pattern."""
    pages = []
    # Find all claver-based helpcontext setters
    for m in CLAVER_PAGE_RE.finditer(text):
        pos = m.start()
        # Scan backwards to find the claver building block
        block_start = text.rfind('\nmacro_GuiSetWinVisable("HELPWIN"', 0, pos)
        if block_start < 0:
            block_start = max(0, pos - 8000)
        block = text[block_start:pos]

        # Get comment (last -- comment before the block)
        comment_m = re.search(r'--([^\n]+)\n(?!.*--)', block)
        comment_raw = comment_m.group(1).strip() if comment_m else ''
        # Skip "comments" that are actually commented-out Lua code
        comment = comment_raw if comment_raw and not comment_raw.startswith('claver') else ''

        # Extract claver string pieces
        pieces = []
        for cm in re.finditer(r'claver\s*=\s*(?:claver\s*\.\.\s*)?"(.*?)"', block, re.DOTALL):
            pieces.append(cm.group(1))
        content_raw = ''.join(pieces)
        content_text = clean_text(lua_str_to_text(content_raw))

        if len(content_text) > 20:
            pages.append({
                'comment': comment,
                'content_text': content_text,
                'pos': pos,
            })
    return pages


# ── Category classification ───────────────────────────────────────────────────

# A map from comment keywords → category hint
COMMENT_CAT_HINTS = [
    # Exact matches / startswith for quest-style comments
    ('Back to Earth', '201'),
    ('Spinning', '201'),
    ('Pet(I)', '201'),
    ('Pet(II)', '201'),
    ('Dragonfly', '201'),
    ('First Trial', '201'),
    ('Behind the Curtain', '201'),
    ('Spirit of Justice', '202'),
    ('Magic Flask', '202'),
    ('Doomsday', '204'),
    ('Jeff the Door', '204'),
    ('Ghost', '204'),
    ('skill', '400'),
    ('Skill', '400'),
    ('shortcut', '400'),
    ('Shortcut', '400'),
    ('Tip', '110'),
    ('tip', '110'),
    ('combat', '110'),
    ('newbie', '100'),
    ('Newbie', '100'),
    ('Gather', '400'),
    ('Living', '400'),
    ('Guild', '400'),
    ('Marriage', '400'),
    ('Tame', '400'),
    ('Renown', '400'),
    ('Zodiac Skill', '400'),
]

# System help page topics (for 400xxx)
SYSTEM_HELP_TOPICS = {
    '400001': 'Gather System',
    '400002': 'Living System',
    '400003': 'Aptitude System',
    '400004': 'Tame System',
    '400005': 'Marriage System',
    '400006': 'Guild System',
    '400007': 'War of Divine Animal',
    '400008': 'Renown Quest',
    '400009': 'Guild War',
    '400010': 'Character Show System',
    '400011': 'Zodiac Skill System',
    '400012': 'Team System',
    '400013': 'PK System',
    '400014': 'Item System',
    '400015': 'Combat System',
    '400016': 'Chat System',
    '400017': 'Map System',
    '400018': 'Shop System',
    '400019': 'Friend System',
}


# ── Output formatters ─────────────────────────────────────────────────────────

def format_page(page: dict, heading_level: int = 3) -> str:
    prefix = '#' * heading_level
    comment = page['comment']
    lines = []
    if comment:
        lines.append(f'{prefix} {comment}')
        lines.append('')
    content = page['content_text']
    if content:
        lines.append(content)
    lines.append('')
    return '\n'.join(lines)


# ── Main extraction logic ─────────────────────────────────────────────────────

def main() -> None:
    print(f"Reading {SCRIPT_GCG} ...")
    data = SCRIPT_GCG.read_bytes()
    text = data.decode('latin-1')
    print(f"  {len(data):,} bytes")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── Extract everything ────────────────────────────────────────────────────
    print("Extracting help pages ...")
    pages = extract_help_pages(text)
    print(f"  {len(pages)} direct helpcontext pages")

    print("Extracting claver-based pages ...")
    claver_pages = extract_claver_pages(text)
    print(f"  {len(claver_pages)} claver pages")

    print("Extracting help catalog ...")
    catalog = extract_catalog(text)
    total_ids = sum(len(v) for v in catalog.values())
    print(f"  {total_ids} catalog IDs across {len(catalog)} categories")

    # ── Write combat tips ─────────────────────────────────────────────────────
    print("Writing combat-tips.md ...")
    write_combat_tips(text, OUTPUT_DIR / "combat-tips.md")

    # ── Write system help ─────────────────────────────────────────────────────
    print("Writing system-help.md ...")
    write_system_help(text, pages, OUTPUT_DIR / "system-help.md")

    # ── Write main quest chapters ─────────────────────────────────────────────
    print("Writing main quest chapters ...")
    write_quest_chapters(pages, catalog, OUTPUT_DIR)

    # ── Write full all-pages dump ─────────────────────────────────────────────
    print("Writing all-help-pages.md ...")
    write_all_pages(pages + claver_pages, OUTPUT_DIR / "all-help-pages.md")

    # ── Write catalog index ───────────────────────────────────────────────────
    print("Writing index.md ...")
    write_index(catalog, OUTPUT_DIR / "index.md")

    print(f"\nDone. Output: {OUTPUT_DIR}/")


# ── Writers ───────────────────────────────────────────────────────────────────

def write_combat_tips(text: str, out: Path) -> None:
    """Extract and write combat tip pages (shown during battle loading)."""
    # Pattern: (i==N)then \n claver = "\n#0<3>Tip..."
    tip_re = re.compile(
        r'\(i\s*==\s*(\d+)\)\s*then\s*\r?\n'
        r'claver\s*=\s*"(.*?)"',
        re.DOTALL,
    )
    tips: dict[int, list[str]] = defaultdict(list)
    for m in tip_re.finditer(text):
        n = int(m.group(1))
        content = clean_text(lua_str_to_text(m.group(2)))
        if content and len(content) > 10:
            tips[n].append(content)

    lines = ["# Combat Tips", "",
             "Tips shown during battle loading screens (`110xxx` help section).", ""]
    for n in sorted(tips):
        for content in tips[n]:
            lines.append(f"**Tip {n}:** {content}")
            lines.append("")

    out.write_text('\n'.join(lines), encoding='utf-8')
    print(f"  {sum(len(v) for v in tips.values())} tips → {out.name}")


def write_system_help(text: str, pages: list[dict], out: Path) -> None:
    """Write system help pages (Gather, Living, Aptitude, etc.)."""
    lines = ["# System Help", "",
             "In-game help pages for game systems (`400xxx`–`401xxx`).", ""]

    # The system help pages have comments describing the system
    system_keywords = {
        'Skill System': '400003',
        'Gathering': '400001',
        'Living': '400002',
        'Team': '400012',
        'PK': '400013',
        'Shortcut': 'hotkeys',
        'chat': '400016',
        'Map': '400017',
        'Shop': '400018',
        'Friend': '400019',
        'Guild': '400006',
        'Marriage': '400005',
        'Pet': '400004',
        'Renown': '400008',
        'War of Divine': '400007',
        'Guild War': '400009',
        'Zodiac Skill': '400011',
    }

    written_topics: set[str] = set()

    for page in pages:
        comment = page['comment']
        content = page['content_text']
        if not content:
            continue
        # Check if this looks like a system help page
        for kw, sid in system_keywords.items():
            if kw.lower() in comment.lower() and sid not in written_topics:
                lines.append(f"## {comment}")
                lines.append(f"*Help ID prefix: {sid}*")
                lines.append("")
                lines.append(content)
                lines.append("")
                written_topics.add(sid)
                break

    out.write_text('\n'.join(lines), encoding='utf-8')
    print(f"  {len(written_topics)} sections → {out.name}")


def write_quest_chapters(pages: list[dict], catalog: dict, output_dir: Path) -> None:
    """Write main story quest help chapters."""
    # First, build a map from title keywords → help ID from catalog
    title_to_id: dict[str, str] = {}
    for cat, entries in catalog.items():
        if not (cat.startswith('2') or cat.startswith('1')):
            continue
        for entry in entries:
            title = GBK_PAIR_RE.sub('', entry['title'])
            title = GBK_LONE_RE.sub('', title).strip()
            # Normalize: remove (I), (II) etc and extra punctuation
            norm = re.sub(r'\s*\([IVX]+\)\s*$', '', title).strip().lower()
            title_to_id[norm] = entry['id']
            title_to_id[title.lower()] = entry['id']

    # Assign each page to a chapter based on its comment
    chapter_pages: dict[str, list[dict]] = defaultdict(list)
    unassigned = []

    for page in pages:
        comment = page['comment']
        if not comment:
            continue
        assigned = False
        # Try to match comment to a catalog title
        comment_lower = comment.lower()
        for title, hid in title_to_id.items():
            if title and title in comment_lower:
                cat = hid[:3]
                chapter_pages[cat].append(page)
                assigned = True
                break
        if not assigned:
            # Try category hints
            for kw, cat in COMMENT_CAT_HINTS:
                if kw in comment:
                    chapter_pages[cat].append(page)
                    assigned = True
                    break
        if not assigned:
            # Check if looks like a quest (has NPC, Lvl patterns)
            if re.search(r'Lvl\.\d|NPC|Apollo|Quest|quest', comment):
                unassigned.append(page)

    # Write per-chapter files for quest categories (skip system/combat/newbie handled elsewhere)
    SKIP_CATS = {'100', '110', '300', '400', '401'}
    chapters_written = 0
    for cat in sorted(chapter_pages.keys()):
        if cat not in CATEGORY_NAMES or cat in SKIP_CATS:
            continue
        name = CATEGORY_NAMES[cat]
        out = output_dir / f"{name}.md"

        cat_catalog = sorted(catalog.get(cat, []), key=lambda e: e['id'])
        cat_pages = chapter_pages[cat]

        file_lines = [
            f"# {name.replace('-', ' ').title()}",
            "",
            f"Quest help chapter `{cat}xxx` — {len(cat_catalog)} quests.",
            "",
        ]
        if cat_catalog:
            file_lines.append("## Quest List")
            file_lines.append("")
            for entry in cat_catalog:
                title = GBK_PAIR_RE.sub('', entry['title'])
                title = GBK_LONE_RE.sub('', title).strip()
                file_lines.append(f"- **{entry['id']}** — {title}")
            file_lines.append("")

        if cat_pages:
            file_lines.append("## Quest Details")
            file_lines.append("")
            for p in cat_pages:
                file_lines.append(format_page(p, heading_level=3))

        out.write_text('\n'.join(file_lines), encoding='utf-8')
        chapters_written += 1

    # Write unassigned pages
    if unassigned:
        out = output_dir / "quest-unassigned.md"
        lines = ["# Unassigned Quest Pages", ""]
        for p in unassigned:
            lines.append(format_page(p))
        out.write_text('\n'.join(lines), encoding='utf-8')
        print(f"  {len(unassigned)} unassigned → quest-unassigned.md")

    print(f"  {chapters_written} chapter files")


def write_all_pages(pages: list[dict], out: Path) -> None:
    """Write a single file with ALL help pages in order."""
    lines = [
        "# All In-Game Help Pages",
        "",
        f"Complete dump of all {len(pages)} help pages from `script.gcg`.",
        "",
        "Pages are in the order they appear in the Lua scripts.",
        "",
        "---",
        "",
    ]
    for i, page in enumerate(pages, 1):
        comment = page.get('comment', '') or f'Page {i}'
        lines.append(f"## {i}. {comment}")
        lines.append("")
        lines.append(page.get('content_text', ''))
        lines.append("")
        lines.append("---")
        lines.append("")

    out.write_text('\n'.join(lines), encoding='utf-8')
    print(f"  {len(pages)} pages → {out.name}")


def write_index(catalog: dict, out: Path) -> None:
    """Write the master help catalog index."""
    lines = [
        "# Zodiac Online — Help Catalog Index",
        "",
        "All help page IDs extracted from `script.gcg` `#2<N><ID><0>Title` links.",
        "",
        "| Category | Pages | ID Range | Guide File |",
        "|----------|-------|----------|------------|",
    ]
    for cat in sorted(catalog.keys()):
        entries = sorted(catalog[cat], key=lambda e: e['id'])
        name = CATEGORY_NAMES.get(cat, f'chapter-{cat}')
        id_range = f"{entries[0]['id']}–{entries[-1]['id']}"
        lines.append(f"| `{cat}xxx` | {len(entries)} | {id_range} | [{name}.md]({name}.md) |")

    lines.extend([
        "",
        "## Guide Files",
        "",
        "- [index.md](index.md) — This catalog index",
        "- [combat-tips.md](combat-tips.md) — Battle loading tips (110xxx)",
        "- [system-help.md](system-help.md) — Game system help (400xxx+)",
        "- [all-help-pages.md](all-help-pages.md) — All pages in order",
        "- [quest-unassigned.md](quest-unassigned.md) — Unclassified quest pages",
        "",
        "### Main Quest Chapters",
        "",
    ])
    for cat in sorted(catalog.keys()):
        if not cat.startswith('2'):
            continue
        name = CATEGORY_NAMES.get(cat, f'chapter-{cat}')
        entries = catalog[cat]
        lines.append(f"- [{name}.md]({name}.md) — {len(entries)} quests")

    out.write_text('\n'.join(lines), encoding='utf-8')
    print(f"  {sum(len(v) for v in catalog.values())} catalog entries → {out.name}")


if __name__ == "__main__":
    main()
