# Zodiac Online Server Context

`CLAUDE.md` is now an index. Load the specific note you need from [`context/README.md`](/home/nikon/projects/zo-server/context/README.md) instead of pulling a single large file into context.

## Recommended Files
- [`context/protocol.md`](/home/nikon/projects/zo-server/context/protocol.md)
  Packet format, login/game flow, `0x03f1`, `0x0407`, and handshake details.

- [`context/maps-heaven.md`](/home/nikon/projects/zo-server/context/maps-heaven.md)
  Confirmed Heaven-side map ids, Peach Garden/Cloud Hall travel, and Apollo film notes.

- [`context/maps-human-world.md`](/home/nikon/projects/zo-server/context/maps-human-world.md)
  Confirmed `101/102/103` ids and the working Rainbow Valley/Bling travel chain.

- [`context/npc-rendering.md`](/home/nikon/projects/zo-server/context/npc-rendering.md)
  `macro_AddMapNpc`, world-spawn behavior, and current rendering constraints.

- [`context/reverse-engineering.md`](/home/nikon/projects/zo-server/context/reverse-engineering.md)
  Ghidra project details, renamed functions, map/tile data findings, and extraction notes.

## Current High-Value Facts
- Client travel requests do not include destination map/x/y.
- `.b` tile data identifies trigger cells but does not encode destination.
- The server still has to map `(mapId, subtype, scriptId, and sometimes x/y)` to scene transitions.
- Confirmed human-world ids:
  - `101` = `Rainbow Valley`
  - `102` = `Bling Alley`
  - `103` = `Bling Spring`
- Confirmed Heaven ids:
  - `206` = `South Gate`
  - `207` = `Cloud Hall`
  - `208` = `Covert Palace`
  - `209` = `Peach Garden`
- Apollo film exit is confirmed as:
  - `0x03f1 / sub=0x02 / mode=0xfe / contextId=12 / extra=0 / script=20001`

## Open Items
- Exact world-entity spawn/update fields needed to render all named NPCs cleanly.
- More automated extraction for maps that do not expose travel as a simple `RoleCheckRound -> macro_ChangeScene` pair.
