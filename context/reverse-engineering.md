# Reverse Engineering Notes

## Status
- Combat-specific reverse-engineering notes were intentionally cleared on 2026-03-20.
- Rebuild combat understanding from fresh packet captures, client tracing, and isolated experiments.

## Source Of Truth
- Prefer, in order:
  - live client UI / runtime behavior
  - client binary handlers in `gc12.exe`
  - client archive data from `gcg/attrres.rc`
  - extracted dumps or copied server-side resources
- Practical rule:
  - if dump output disagrees with the running client, the dump is wrong for server behavior purposes.

## Current Data Pipeline
- Client archive:
  - `/home/nikon/Data/Zodiac Online/gcg/attrres.rc`
- Full extraction:
  - `scripts/extract-client-archive.py`
  - output: `data/client-derived/archive/`
  - manifest: `data/client-derived/archive/attrres-manifest.json`
- Derived table generation:
  - `scripts/generate-client-derived-tables.py`
  - source is the extracted repo copy, not the live install path
- Current derived JSON:
  - `equipment.json`
  - `weapons.json`
  - `items.json`
  - `potions.json`
  - `stuff.json`
  - `iteminfo.json`
  - `combinitem.json`
  - `weektask.json`
  - `helpfiles.json`
  - `roleinfo.json`
  - `quests.json`
  - `quest-flow.json`
  - `task-runtime.json`
  - `quest-schema.json`
  - `task-state-clusters.json`
  - `task-state-matches.json`
  - `task-chains.json`
  - `quest-workflow.json`
  - `quest-dispatch.json`
  - `quest-full-workflow.json`
  - `task-context.json`
  - `quest-runtime-candidates.json`

## Stable Non-Combat Findings
- Quest runtime flow is abstracted through the objective registry and preserves client-visible quest semantics.
- Quest item grants and consumes use the shared effect executor path.
- Inventory definitions load from client-derived data:
  - `items.json`
  - `potions.json`
  - `stuff.json`
  - `equipment.json`
  - `weapons.json`
- Role-derived runtime data currently covers:
  - monster primary drop lookup from `roleinfo.json`
  - monster name lookup from `roleinfo.json`
  - starter-role gender lookup from `roleinfo.json`
  - scene ordinary-monster lookup by location text from `roleinfo.json`
- Quest-derived runtime data currently covers:
  - help-flow extraction from `script.gcg`
  - reward blocks and NPC task tables
  - merged quest metadata / flow / runtime evidence
  - state-cluster extraction and matching
  - runtime candidate generation for `main-story.json`
- Quest abort/reset is confirmed on `0x03f1 sub=0x05`, not inbound `0x03ff`.
- Shopkeeper inn rest is keyed on the full server-run context tuple, not `scriptId` alone.
- Client max HP/MP uses additive caps beyond the derived aptitude formula.
- `roleinfo.txt` practical read:
  - `roleClassField=1` player avatars
  - `roleClassField=2` pets
  - `roleClassField=3` NPCs
  - `roleClassField=4` ordinary monsters
  - `roleClassField=5` elite/guard/boss style roles

## Current Limits
- No real crafting runtime yet.
- No full client-script quest interpreter yet.
- `iteminfo.json` semantics are only partially decoded.
- `combinitem.json` is queryable but not yet enforced in gameplay.
- Full `roleinfo` stat-field semantics are still only partly decoded.

## Next Best Steps
- Use `src/crafting-data.js` when implementing compose/socket/refine handlers.
- Continue replacing hand-maintained item and monster behavior with client-derived tables.
- Build the next quest-runtime step as a real quest macro tracer/interpreter.
- Re-derive combat notes separately from clean captures instead of relying on prior assumptions.
