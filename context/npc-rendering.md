# NPC Rendering Notes

## Core Finding
- `macro_AddMapNpc(npcId, npcTypeFlags, name, x, y)` is map/UI/script metadata
- The second argument is a category bitmask, not a world `entity_type`
- `mapnpclist` is the right-hand map/sidebar NPC list control in `MAINMAP`
- `worldmapnamelist` is a different list control and should not be treated as the same data source

Categories seen in scripts:
- `PLAYER=1`
- `SELL=2`
- `TASK=4`
- `OTHER=8`

Practical bit usage observed in client UI:
- `Quest` button in `MAINMAP` runs `macro_SetMapNpcBlink(2)`
- `Function` button in `MAINMAP` runs `macro_SetMapNpcBlink(4)`
- runtime rows often use combined flags like `3`, `5`, `7`
- `macro_SetMapNpcBlink(mask)` filters/recolors existing `mapnpclist` rows by bitmask; it does not create the rows

## Client Rendering Path
- `ScriptMacroSetClientNpcType` writes a client-side override to `entity + 0x5d8`
- `ApplyClientNpcTypeAndRefreshAppearance` rebuilds visuals from that override
- `0x03eb / 0x15` goes through `ParseEntitySpawnFrom03eb`
- That path supports both short and extended entity forms

## Map Sidebar Path
- `MAINMAP` UI definition lives in `gcg/ui.gcg`
- Relevant `MAINMAP` controls:
  - `mapnpclist`: sidebar NPC names
  - `showtasknpc`: `macro_SetMapNpcBlink(2)`
  - `showsellnpc`: `macro_SetMapNpcBlink(4)`
  - `showothernpc`: opens `WORLDMAP`
- Binary/runtime path:
  - `macro_AddMapNpc(...)` populates both `mainMap` and `mapnpclist`
  - `macro_SetMapNpcBlink(...)` rebuilds `mapnpclist` from existing `mainMap` rows using the bitmask
- `macro_AddMapNpc` does not imply world spawn ownership
  - the same NPC id can appear across related maps / city interiors / mini-portal submaps
  - map-sidebar coordinates can exceed the base scene dimensions, especially in city clusters like Cloud City

## Runtime Capture Findings
- Static `script.gcg` scene-title blocks do contain `macro_AddMapNpc(...)` calls, but they are not the whole sidebar source for hub maps
- Live runtime capture in Cloud City showed `74` sidebar rows, far more than the plain `Cloud City` title block's `6` unconditional `macro_AddMapNpc(...)` calls
- Cloud City runtime sidebar capture is saved at:
  - `data/client-derived/cloud-city-runtime-mapnpclist.json`
- In that capture:
  - `39 / 74` rows are outside the base `256x256` map bounds
  - several entries are duplicated or repeated with different coordinates
  - the runtime sidebar coordinate set does not match the current `scenes.json` world-spawn coordinate set
- Conclusion:
  - treat sidebar NPC data and world-spawn NPC data as separate datasets
  - do not use sidebar rows directly as authoritative world spawn coordinates

## Current Practical State
- Static world-spawn replay works for multiple scenes when the scene/NPC ids are correct
- Confirmed useful cases:
  - Peach Garden recovered NPC block
  - Bling Alley (`102`)
  - Bling Spring (`103`)
- Offline helper scripts now available:
  - `scripts/extract-client-ui-window.py`
  - `scripts/extract-map-sidebar-npcs.py`
  - `scripts/generate-client-map-sidebar-data.py`
  - `scripts/extract-client-mapnpcinfo.py`
  - `scripts/generate-client-map-npc-info.py`
  - `scripts/report-map-npcs.py`
  - `scripts/parse-addmapnpc-log.py`
- Generated sidebar dataset:
  - `data/client-derived/map-sidebar-npcs.json`
  - includes all `199` scenes as a scene-centric index
  - current coverage:
    - `146` scenes with matched static sidebar blocks
    - `1` scene with runtime-capture evidence
    - `16` static blocks still unmatched
    - `10` static blocks still ambiguous across duplicate-name scenes
  - this dataset must be treated as sidebar/map-UI evidence, not world-spawn truth
- Hidden map-panel detail dataset:
  - `data/client-derived/mapnpcinfo/manifest.json`
  - extracted scripts live in `data/client-derived/mapnpcinfo/scripts/`
  - normalized JSON lives in `data/client-derived/map-npc-info.json`
  - canonical merged backend JSON lives in `data/client-derived/map-npcs.json`
  - current extraction result:
    - `106` scripts across `47` maps plus fallback `0.lua`
    - filenames follow `mapId_roleId.lua`
    - examples: `112_3013.lua`, `112_3065.lua`, `112_3193.lua`
  - regeneration no longer requires a fresh live `/tmp` script-index dump
    - `scripts/extract-client-mapnpcinfo.py` now uses cold-disk `reference_signature` mode against `script.gcg`
  - normalized JSON summary:
    - `199` indexed scenes
    - `105` NPC scripts
    - `158` parsed task entries
    - preserves `recommendedLevel`, task id/title, and client color-variant semantics
  - backend ownership:
    - `src/map-npcs.ts` is the canonical backend access module
    - `src/map-npc-info.ts` is now a compatibility wrapper over `src/map-npcs.ts`
    - `src/scene-runtime.ts` bootstrap static NPC spawns now resolve through `src/map-npcs.ts`

## Known Limits
- Some named NPCs still likely need richer spawn data or a client-side `npc_id -> clientNpcType` step
- Apollo in Peach Garden is still not proven to be a normal world spawn
- Hidden `mapnpcinfo` Lua is now extracted into `data/client-derived/mapnpcinfo/scripts/`
- The extraction no longer needs a fresh live script-index dump for normal regeneration
- The current cold-disk mode is still signature-based for this client version, not a universal archive-format decoder
- The visible sidebar for hub maps can be augmented by runtime script execution beyond the nearest static scene-title block in `script.gcg`

## Scene Data Rule
Use client `macro_AddMapNpc(...)` blocks where they match reality. Keep clearly demo-only or conditional NPCs out of default world spawns unless they are confirmed visible in the default scene.
