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
- Shared item packet findings:
  - `0x03ee / sub=0x02 / u32 instanceId` = discard item
  - `0x03ee / sub=0x03 / u32 instanceId` = use item on self/default target
  - `0x03ee / sub=0x08 / u32 instanceId / u32 targetEntityId` = use item on explicit target
- Player item use is authoritative on the server and correctly mutates/persists vitals.
- Generic immediate player-HUD vitals refresh now works through `0x03f6 / sub=0x0c` using absolute values:
  - discriminator `0x0b` -> current HP
  - discriminator `0x0c` -> current MP
  - discriminator `0x0d` -> current rage
  - this path updates the live HUD immediately without touching baseline attributes
  - use this for player self-heal, inn rest, and other current-vitals-only updates
- Do not use `0x03f6 / sub=0x0a` as a live vitals refresh packet:
  - client parser around `0x4303cf` does `push packet_level`, `push 1`, `call 0x441ba0`
  - `0x441ba0` applies `delta = new_level - old_level` to additive base attributes
  - in this path `old_level` is hardcoded to `1`
  - repeated `0x03f6 / 0x0a` therefore adds `level - 1` to displayed baseline attributes every time
- Forced `level=1` in `0x03f6 / 0x0a` proved the packet can refresh HP/MP immediately, but it also visibly resets the character level to `1`, so that hack is not usable.
- Live client HUD vitals are at:
  - HP `0x008ebf78`
  - MP `0x008ebf7c`
  Item use with the current server flow did not write either address.
- Direct client vitals adjustors:
  - `0x441320` current HP
  - `0x441380` current MP
  - `0x4413d0` third live meter
- Consumable-effect caller around `0x4495c7` reads effect values from:
  - `item + 0xa0` HP
  - `item + 0xa4` MP
  - `item + 0xa8` third meter
  then calls the direct vitals adjustors above. This is the strongest lead for the real live HUD refresh path.
- Ordinary self-use (`0x03ee / sub=0x03`) enters `SendUseItemRequest_03EE_Sub03` at `0x430bc0`.
  - Live trace confirmed the networked UI path passes `param_2 = 1`.
  - `ApplyLocalConsumableUseAndValidate` at `0x4494a0` skips local HP/MP apply when that flag is nonzero via the branch at `0x4495cf`.
  - This client patch is now a fallback only. Prefer the generic server-side `0x03f6 / 0x0c` vitals update path first.
  - Client patch point:
    - address `0x004495cf`
    - original bytes `0f 85 01 04 00 00`
    - patched bytes `90 90 90 90 90 90`
  - Repo patch script:
    - `scripts/patch-client-item-use-local-apply.py`
    - apply: `python3 scripts/patch-client-item-use-local-apply.py '/home/nikon/Data/Zodiac Online/gc12.exe'`
    - restore: `python3 scripts/patch-client-item-use-local-apply.py --restore '/home/nikon/Data/Zodiac Online/gc12.exe'`
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
- Inn rest should not send an immediate `sendSelfStateAptitudeSync()` afterward.
  Removing that extra character sync fixed the A&D panel/base-stat drift after resting.
- Equip/unequip should not force immediate bag/equipment resyncs after every toggle.
  The client already applies the local change, and extra forced resyncs caused equipment/state corruption.
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
- For item healing/UI work, trace the inbound client path that reaches `0x4495c7` and then `0x441320` / `0x441380`.
- Revert temporary `levelOverride: 1` item-use experiments before treating item-use sync as stable.
