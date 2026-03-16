# Reverse Engineering Notes

## Client Files
- Game root: `/home/nikon/Data/Zodiac Online/`
- Main executable: `gc12.exe`
- Login DLL: `Login.dll`

## Ghidra
- Project: `/home/nikon/ghidra/ZO.gpr`
- MCP endpoint: `http://127.0.0.1:8089/`

## Useful Renames
- `RegisterPacketHandlers` at `0x00514c00`
- `HandleGamePacket03ed` at `0x00504820`
- `HandleGamePacket03fa` at `0x00504b70`
- `HandleGamePacket03f0` at `0x005052a0`
- `HandleGamePacket03f1` at `0x0050bda0`
- `DispatchFightStream03fa` at `0x0051f5e0`
- `EnterFightMode` at `0x00518a10`
- `ReadEntityFromPacket` at `0x00436930`
- `LookupEntityTemplate` at `0x00444790`
- `GetGameObject` at `0x0040f200`
- `GetActiveEntity` at `0x0040f1f0`

## Map / Scene Notes
- `MapCelLoad` uses 6-byte tile scene records:

```c
struct MapCellSceneRecord {
  uint16_t flags;
  uint16_t scene_id;
  uint16_t aux_value;
};
```

- Useful helpers:
  - `FUN_00422250(x, y)` -> scene id
  - `FUN_004222a0(x, y)` -> aux value
  - `FUN_00422200(x, y, mask)` -> flag test
- Tile scene data identifies triggers, not destinations.
- Scene travel is best reconstructed from script extraction plus live `0x03f1` requests.

## Core Combat Findings
- `0x03fa` is the main fight stream dispatcher.
- `0x03fa / 0x65` is the confirmed live synthetic fight-enter packet in the current harness.
- `0x03fa / 0x34` is the main `FIGHTCONTROL` show/refresh path.
- `0x03fa / 0x01` is the strongest confirmed ring-open control path.
- `0x03fa / 0x03` serves two important roles:
  - active-slot state toggle
  - primary normal-attack playback packet
- `0x03fa / 0x66` and `0x03fa / 0x67` are broad structured aftermath/state packets.
- `0x03fa / 0x0a` is tied to summon/pet flow and should not be used as generic fight startup.
- `0x03f0` is the turn/action table, not fight entry.

## `0x03fa / 0x65` Client Parse
- Live parser work around `0x005223d0` showed two row shapes:
  - active player row: base fields plus extended tail
  - non-player rows: base fields only
- This was the key multi-enemy startup bug.
- Earlier harness bug:
  - enemy rows also included the extended tail
  - with one enemy this was tolerated
  - with two enemies it shifted the next row and corrupted parse state

## `Combat data error!` Breakpoint Result
- Popup string found at `0x005d508c`.
- Live breakpoint hit at `0x00522809`.
- Failure path:
  - `0x005227db` prepares dialog
  - `0x00522802` calls `0x004c9c70`
  - `0x00522809` calls `0x004cac10`
- Success path just above calls `0x00519bf0`.
- `0x00519bf0` validates board placement:
  - first signed value must satisfy `0 <= value < 3`
  - third signed value must satisfy `0 <= value < 5`
  - side handling only accepts expected values
- At the broken multi-enemy startup breakpoint the client had decoded:
  - `row = 2`
  - `col = 3`
  - `side = 0x78`
- `0x78` is decimal `120`, matching the synthetic enemy HP.
- Conclusion:
  - the second fighter row was misaligned
  - the client was reading side from the previous row’s HP byte

## `0x03fa / 0x65` Practical Current Model
- Player row currently needs:
  - base fields
  - extended tail
  - name block
- Enemy rows currently need:
  - base fields only
- Other confirmed row facts:
  - per-entry `side` byte is mandatory
  - zero-length names are rejected
  - player/enemy placement worked after using:
    - player side `0xff`
    - enemy side `1`

## `0x03fa / 0x03` Playback
- Working playback shape:

```text
u32 attacker_runtime_id
u32 target_runtime_id
u8  result_code
u32 damage
```

- This produces visible normal-attack animation.

## `0x03f0` Action Table
- Handler path:
  `HandleGamePacket03f0 -> FUN_00431a40 -> FUN_0054ce10 -> FUN_0054cd70`
- For `mode == 0`:

```text
u8  mode
u16 count
repeat count:
  u16 field_a
  u16 field_b
  u16 field_c
```

- `field_a` is the action-definition lookup id.
- `field_b` behaves like a setup level/index.
- `field_c` is another setup field stored into the action object.
- `FIGHTCONTROL.skill` only builds the skill submenu; it is not the outer command wheel.

## Command Ring State
- Top-level command wheel is tied to `GetGameObject()->0x3bbc`.
- `0x03fa / 0x01` is the clearest incoming path that:
  - validates the active fighter with `FUN_00515cf0`
  - runs `FIGHTCONTROL`
  - sets `0x3bbc = 1`
- The client emits bare `0x03ed / 0x09` readiness/advance packets during the fight loop.

## Attack Packet
- Client attack click sends `0x03ed / 0x03` with three bytes.
- Original server path:
  - action handler `0x00463130`
  - then `0x00430380`
  - then `0x0043ae30`
- Normal attack mode is `3`.

## Physical Damage Core
- Dumped fight scripts:
  - `afight.lua`
  - `dfight.lua`
- Both show combat is attribute-driven, not fixed-damage:

```text
aact = macro_GetActAttr(22)
adef = macro_GetActAttr(8)
dact = macro_GetDefAttr(22)
ddef = macro_GetDefAttr(8)
res  = ddef - aact
```

- More concrete native physical-hit arithmetic appears in `fight_part2.c`:

```text
hitChance = min(95, floor(attacker_stat6 * 8 / max(defender_stat7, 1)) + 70)
roll      = random(attacker_attr0x15, attacker_attr0x16)
damage    = floor((roll * roll) / max(roll + defender_stat8 * 2, 1))
```

- If `|attacker_level - defender_level| > 5`, native code scales damage by `(levelDiff * 4 + 100)%`.
- Additional elemental/resistance scaling exists through attacker attr selection around `0x37` and defender attrs `0x38..0x3b`.
- Miss handling is clearly part of the native path, but the exact client playback result byte for misses is still not confirmed.

## Enter-Game Identity Note
- `ReadEntityFromPacket` loads the active entity runtime id into `activeEntity + 0x5b0`.
- Client fight-command lookups use that id via `FUN_00515cf0`.
- This was important for making the active player recognized as a combatant.

## Current Outcome
- Single-enemy startup is the stable reference.
- Multi-enemy `Combat data error!` was traced to row misalignment in `0x03fa / 0x65`.
- Current local fix is the player-row/ enemy-row shape split.
- Defeat / respawn findings:
  - server log confirms the defeat path can transition the player to Rainbow Valley with a fresh enter-game bootstrap
  - the remaining client-facing defect is not “server failed to respawn”, but “client still shows reward/result UI or odd combat-close behavior depending on the defeat-close packet family”
  - client dispatcher mapping from `gc12.exe`:
    - `0x03fa / 0x66` -> `FUN_00520f3e`
    - `0x03fa / 0x67` -> `FUN_005211c0`
    - `0x03ee / 0x58` does not map to a dedicated close handler; it falls through the generic/default path
  - `0x66` is a win/result-state packet:
    - updates local hp/mp/rage
    - can parse optional reward/result payload into fight-end buffers
    - sets `+0x3cb4 = 1`, later shown by `FUN_00519ca0` as `Won combat`
  - `0x67` is the failure-state packet:
    - updates local hp/mp/rage mirror only
    - sets `+0x3cb4 = 2`, later shown by `FUN_00519ca0` as `Combat failed`
    - does not populate the reward/item-list buffers used for the loot window
  - fight teardown is not immediate on packet receipt:
    - combat loop `FUN_00523b70` waits for end-of-round / animation settle and then calls `FUN_00519ca0`
  - loot/reward UI is not supposed to appear on player defeat:
    - `FUN_00519ca0` only opens `FIGHTWIN.itemlist` when reward/result buffers are non-zero
    - sending `0x66` on defeat is the most plausible way to trigger a false reward/result screen
- Remaining work should focus on defeat-close packet semantics and turn-flow polish, not on the old startup popup path.
