# NPC Rendering Notes

## Core Finding
- `macro_AddMapNpc(npcId, npcTypeFlags, name, x, y)` is map/UI/script metadata
- The second argument is a category bitmask, not a world `entity_type`

Categories seen in scripts:
- `PLAYER=1`
- `SELL=2`
- `TASK=4`
- `OTHER=8`

## Client Rendering Path
- `ScriptMacroSetClientNpcType` writes a client-side override to `entity + 0x5d8`
- `ApplyClientNpcTypeAndRefreshAppearance` rebuilds visuals from that override
- `0x03eb / 0x15` goes through `ParseEntitySpawnFrom03eb`
- That path supports both short and extended entity forms

## Current Practical State
- Static world-spawn replay works for multiple scenes when the scene/NPC ids are correct
- Confirmed useful cases:
  - Peach Garden recovered NPC block
  - Bling Alley (`102`)
  - Bling Spring (`103`)

## Known Limits
- Some named NPCs still likely need richer spawn data or a client-side `npc_id -> clientNpcType` step
- Apollo in Peach Garden is still not proven to be a normal world spawn

## Scene Data Rule
Use client `macro_AddMapNpc(...)` blocks where they match reality. Keep clearly demo-only or conditional NPCs out of default world spawns unless they are confirmed visible in the default scene.
