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
    - `0x03fa` packet family is handled by `HandleCombatCommandPacket_03FA`
    - `0x03fa / 0x66` -> `FUN_00520f3e`
    - `0x03fa / 0x67` -> `FUN_005211c0`
    - `0x03ee / 0x58` does not map to a dedicated close handler; it falls through the generic/default path
  - `0x66` is a win/result-state packet:
    - updates local hp/mp/rage
    - can parse optional reward/result payload into fight-end buffers
    - sets `+0x3cb4 = 1`, later shown by `FinalizeCombatAndShowResultUI` as `Won combat`
    - concrete case label is `CombatCommand_66_HandleVictoryResult`
    - fills the combat reward block:
      - `+0x2c08` -> `FIGHTWIN.expvalue`
      - `+0x2c0c` -> numeric value shown through `FIGHTRESULT.petext`
      - `+0x2c20` -> `FIGHTWIN.moneyvalue`
      - `+0x2c2c..+0x2c30` -> dynamic array of loot template ids for `FIGHTWIN.itemlist`
  - `0x67` is the failure-state packet:
    - updates local hp/mp/rage mirror only
    - sets `+0x3cb4 = 2`, later shown by `FinalizeCombatAndShowResultUI` as `Combat failed`
    - does not populate the reward/item-list buffers used for the loot window
    - concrete case label is `CombatCommand_67_HandleDefeatResult`
  - fight teardown is not immediate on packet receipt:
    - combat loop `AdvanceCombatRoundAndFinalizeIfSettled` waits for end-of-round / animation settle
    - after roughly 500ms of settled state or 8s hard timeout, it calls `FinalizeCombatAndShowResultUI`
  - loot/reward UI is not supposed to appear on player defeat:
    - `FinalizeCombatAndShowResultUI` always closes `FIGHTCONTROL`, runs `script\\fightend.lua`, and clears fight state first
    - it only opens `FIGHTWIN.itemlist` when reward/result buffers are non-zero
    - the item list is built from the u16 template-id array at `+0x2c2c..+0x2c30`
    - sending `0x66` on defeat is the most plausible way to trigger a false reward/result screen
  - reward block support helpers:
    - `ResetCombatResultRewardState` zeroes `+0x2c08..+0x2c24` and frees the loot id array at `+0x2c2c`
    - `CombatResultWindowOpenGate` is the point inside `FinalizeCombatAndShowResultUI` that checks:
      - exp value
      - pet-result value
      - opaque flag/value at `+0x2c14`
      - loot item-id count
      before opening `FIGHTWIN`
    - `+0x2c10` triggers a post-fight `0x03f6 / 0x10` style self-state/UI refresh and looks pet-related
    - `+0x2c14` is currently only used as a result-window gate and is still semantically unresolved
    - the reward UI animates toward separate accumulator fields:
      - `+0x2c18` animates toward `FIGHTWIN.expvalue`
      - `+0x2c1c` animates toward the numeric value shown in `FIGHTRESULT.petext`
      - `+0x2c24` animates toward `FIGHTWIN.moneyvalue`
  - there is also a forced-close path:
    - `ForceFinalizeCombatIfPending` checks a pending flag and immediately funnels into `FinalizeCombatAndShowResultUI`
  - additional combat packet-side notes:
  - sampled client send-side `0x03f5` traffic in `FUN_00517a60` is combat-control / combat-secretary related, not ground-loot pickup
  - client send helper `FUN_004322b0` is a generic `0x03f1` request builder reused by several systems; the post-fight `+0x2c10` path goes through that helper and still appears pet-related rather than loot-related
- world-object / acquisition notes:
  - world object type `2` in the main click path is Pet Booth, not loot:
    - click path uses `RequestPetBoothInspect_03F4_Sub6`
    - local self-owned path opens `OpenOrRefreshPetBoothUi`
  - world object type `8` is a gatherable resource node
  - confirmed gather acquisition request flow:
    - `RequestGatherStart_0401_Sub0B` validates distance/tool/skill, stores target object id, and sends `0x0401 / 0x0b` with the target runtime id
    - `UpdateGatherActionProgress` drives the local gather timer/UI (`Gathering...`, `Digging treasure...`, `Searching ...`)
    - when the timer completes, `RequestGatherCompletion_0401_Sub0D` sends `0x0401 / 0x0d` with the same target runtime id
    - `StartGatherProgressUiFromEquippedTool` starts the client-side gather progress UI based on the equipped tool template
  - this gives one confirmed world-item acquisition channel:
    - gather does not appear to use the fight-result reward window
    - the likely server-side result is still normal item/currency delivery (`0x03f3` and `0x03f6`) plus world-object state change, not a bespoke loot UI
  - gather state/control details:
    - `HandlePlayerActionStatePacket_040D` is a broader player-action-state family that includes gather-mode updates
    - subcommand `'b'` disables gather mode via `SetGatherModeAndOptionallyNotify_0400(..., 0, 0)`
    - subcommand `'c'` reads 11 shorts into the local player action-state block and enables gather mode via `SetGatherModeAndOptionallyNotify_0400(..., 1, 0)`
    - `RebuildGatherActionStateEntries` materializes that gather/action-state block into the local entry list at `+0xfac`
    - `SetGatherTargetRuntimeIdAndToolType` stores target runtime id at `+0xd90` and tool/type at `+0xd94`
    - local gather-mode flag lives at `+0xd1b`
    - inbound `0x0400` was a false lead for gather response; the registered `0x0400` packet family is unrelated (video-chat / other UI state)
  - client inventory / loot acquisition structure is clearer now:
    - `GetLocalPlayerEntity` returns the local player entity object at `DAT_0064328c + 0x526e8`
    - that object is constructed by `ConstructLocalPlayerEntity`
    - `InitializeLocalPlayerInventoryContainers` then builds the embedded item containers at:
      - `+0x6f8`
      - `+0x6fc`
      - `+0x700`
      - `+0x704`
      - `+0x708`
      - `+0x70c`
    - `HandleItemBagUpdate_03F3` takes a leading container byte and inserts a fully serialized item instance into that client container
    - `PopulateInteractionSelectionDescriptor` uses container type `-1` for script-backed ground or drop items
    - those script-backed items are provided by `GetOrCreateScriptDropItemRecord`, which loads `script\\dropitem\\%d.lua`
    - this is strong evidence that visible ground loot is represented in the client as a special interaction-source container, not as a fight-result-only concept
  - `0x03f8` is now confirmed as the normal item-service request family:
    - `SendItemServiceRequest_03F8(..., 0x01, runtimeId)` -> gold purchase request
    - `SendItemServiceRequest_03F8(..., 0x0b, runtimeId)` -> coin purchase request
    - `SendItemServiceRequest_03F8(..., 0x02, runtimeId)` -> sell item request
    - `SendItemServiceRequest_03F8(..., 0x04/0x05, runtimeId)` -> repair variant request
    - `SendItemServiceRequest_03F8(..., 0x06, 0xffffffff)` -> full repair style request
    - normal NPC shop purchase is therefore not `0x0412`; `0x0412` remains the separate VIP purchase-result path
  - ground-loot pickup is still not fully resolved, but it now looks more like generic inventory movement than a shop service:
    - `HandleItemContainerInteraction` uses explicit `0x03f8` only for store buy, sell, and repair branches
    - for generic source/target container moves it goes through local-player vtable methods:
      - `+0x58` -> `CanMoveItemBetweenContainers`
      - `+0x5c` -> `SendMoveItemBetweenContainers_03EE_Sub01`
    - `CanMoveItemBetweenContainers(runtimeId, sourceContainer, targetContainer)` validates the source and destination container combination and item-specific restrictions before allowing the move
    - `SendMoveItemBetweenContainers_03EE_Sub01(runtimeId, sourceContainer, targetContainer)` does two things:
      - runs `ApplyLocalUiSideEffectsForItemMove(...)`
      - sends packet `0x03ee / 0x01` with payload:
        - `u32 runtimeId`
        - `u8 sourceContainer`
        - `u8 targetContainer`
    - this is the concrete generic item-move request packet family the client uses for non-shop transfers
    - practical implication:
      - ground pickup is now highly likely to be exactly the same packet, with source container encoded as script-drop (`-1`, i.e. `0xff`) and target container `1` (bag)
      - the remaining unknown is not the opcode anymore, but confirming the exact source-container byte used on a real pickup path
  - adjacent `0x03ee` item actions:
    - local-player vtable `+0x60` -> `SendUseItemRequest_03EE_Sub03`
    - that path validates/locally applies consumable item effects through `ApplyLocalConsumableUseAndValidate`
    - then sends `0x03ee / 0x03` with payload:
      - `u32 runtimeId`
  - `0x03f2` is the inbound inventory-container update family:
    - dispatcher wrapper is `DispatchInventoryContainerUpdatePacket_03F2`
    - main handler is `HandleInventoryContainerUpdatePacket`
    - packet shape starts with `(containerType, subcommand, payload...)`
    - `ApplyInventoryContainerItemUpdateSubcommand` currently mapped subcommands include:
      - `0x00`: bulk item list / full container refresh
      - `0x0b`: embedded-item update
      - `0x14`: stack count update
      - `0x16`: durability-style field update
      - `0x17`: item coord or position update
    - this confirms the server has a richer authoritative container-sync path than only:
      - `0x03f3` add item
      - `0x03f4` remove item
    - practical implication:
      - store buy, pickup, sell, stack split, and other item mutations may rely on `0x03f2` container updates in addition to `0x03f3` / `0x03f4`
  - `0x03ff / 0x0e` is the local task-history setter:
    - handler removes the active quest entry by task id, then writes a single history byte into the local player's quest-history tree at `player + 0xca8`
    - client scripts use `macro_GetTaskHistoryLevel(taskId)` against that tree
    - practical implication:
      - `0x03ff / 0x04` complete is not enough by itself for NPC menus that check task history
      - the server must also send `0x03ff / 0x0e` on completion and on bootstrap sync for already-completed quests
  - live quest-token debugging tightened the model further:
    - `0x03f2 / 0x00` is the authoritative bag refresh path the client uses to populate the counted container state
    - `0x03f3` alone is not enough to conclude `macro_GetItemCount(...)` will succeed
    - for quest token `21098`, the bag tree contained a real item object while `LuaMacro_GetItemCount(21098)` still returned `0`
    - root cause was item-instance field placement, not quest status:
      - template `21098` resolves to family `0x74`
      - `FUN_0053e2a0` counts family `>= 0x40` items by `*(u16 *)(clientItem + 0x08)`
      - writing quantity into the adjacent `u8` field makes the icon visible but the quest UI remains `0/1`
  - later bag debugging ruled out the guessed `0x03f2 / 0x17` position theory for the missing starter item:
    - after fixing quantity placement, only one live starter item still appeared even though the save and bulk sync contained both `20001` and `20004`
    - live template inspection showed both are family `0x41`
    - family `0x41` stops parsing after the base fields plus the embedded-entry count
    - the old server serializer appended six extra `u16` fields anyway, shifting the next item record in `0x03f2 / 0x00`
    - once the serializer became family-aware, both starter items rendered correctly without any `0x17` packet
  - same-bag drag persistence is not a server-protocol problem in the tested client:
    - `HandleItemContainerInteraction` (`0x0048b9a0`) calls `MoveItemBetweenContainerSlots` directly for same-container moves
    - raw server receive logs show no new opcode when dragging an item within the bag
    - implication: startup layout can be server-controlled, but manual drag state is local-only unless the client is modified
  - drop-item UI integration details:
    - `ResolveItemRecordFromInteractionSelection` resolves script-drop selections by calling `GetOrCreateScriptDropItemRecord` when `containerType == -1`
    - world-drop selection widgets and hover/preview paths feed those script-drop records into the same item-tooltip / interaction UI helpers used by normal inventory items
    - this strengthens the model that ground loot is a normal client item-interaction source, not a separate one-off pickup UX
  - adjacent item-management packet details:
    - `RequestSplitItemStack_0400_Sub08` sends `0x0400 / 0x08` with `(containerType, runtimeId, splitAmount)` when the client splits an item stack into the same player-side container family
- Remaining work should focus on defeat-close packet semantics and turn-flow polish, not on the old startup popup path.
