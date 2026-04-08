## `0x03fa` Fight Stream Notes

Client reference: `gc12.exe`

Known `0x03fa` subcommands decoded from the client switch table in `HandleCombatCommandPacket_03FA`:

- `0x01`: ring open / control refresh
- `0x03`: generic hit-resolution packet
- `0x04`: skill-cast packet
- `0x06`: round start
- `0x33`: entity hide
- `0x34`: control show
- `0x64`: fight mode/state
- `0x65`: encounter probe / battle setup
- `0x66`: victory result
- `0x67`: defeat result

### `0x03fa sub=0x03`

This is the normal active-state / hit-resolution path.

Observed client-side layout:

1. `attackerEntityId: u32`
2. `targetEntityId: u32`
3. `resultCode: u8`
4. If `resultCode != 0`:
5. `primaryValue: u32`
6. `secondaryEntityId: u32`
7. `secondaryResultCode: u8`
8. `secondaryValue: u32`

Special case:

- `resultCode == 0x0e` uses an alternate parse path for protect/block-style playback.

### `0x03fa sub=0x04`

This is a separate skill-cast path. It is not the same as `sub=0x03`, and sending only `sub=0x03` for skills causes the client to render combat order incorrectly.

Observed client-side prefix:

1. `casterEntityId: u32`
2. `skillId: u16`
3. `skillLevelIndex: u8`
4. repeated target records until packet end:
5. `targetEntityId: u32`
6. `targetActionCode: u8` (client treats this as per-target hitstate/result)

Important separation:

- the live `sub=0x04` branch is the cast/effect path at `0x5201a3`
- the `HandleCombatSkillTableRebuildPayload -> CombatSkillTable_RebuildFromPacket` parser chain belongs to `0x03f0`, not to `sub=0x04`
- so `0x03f0` experiments must be treated as skill-table rebuilds, not as extra stage-2 payload for `sub=0x04`

Observed behavior in client handler:

- `targetActionCode=1` -> normal successful skill hit path
- `targetActionCode=3` -> lethal/kill path branches
- Self-buff style skill casts can use `0`

Current server implication:

- For skills, send `sub=0x04` first to start the skill animation path.
- Follow with `sub=0x03` only for actual hit/damage resolution if the skill deals damage.
- Do not assume `sub=0x04` alone repairs the offensive-skill disable bug. That bug is tied to separate selector state, not to a hidden `sub=0x04` rebuild payload.

### Confirmed Runtime Handler Chain

Verified from the client dispatcher:

- Global registration:
  - `0x514c50` registers `0x03fa` to handler `0x504b70`
- Runtime chain:
  - `0x504b70 -> 0x514ef0 -> 0x51f5e0`
- Real `0x03fa` case table inside `0x51f5e0`:
  - `sub=0x03` -> `0x520c0c`
  - `sub=0x04` -> `0x5201a3`
  - `sub=0x06` -> `0x51f985`

This replaces earlier guesses around unrelated parser/helper families.

### Confirmed `sub=0x04` Header

Live breakpoints show the `sub=0x04` cast header is currently packed correctly:

1. `casterRuntimeId: u32`
2. `skillId: u16`
3. `levelIndex: u8`

Earlier assumption:

- the server originally sent this byte as a zero-based level index (`skillLevel - 1`)
- for `Enervate` level 1 that meant `levelIndex = 0`

Confirmed current finding:

- this client expects the `sub=0x04` level byte to be one-based
- changing the server packet to send `level = 1` for level-1 `Enervate` made the skill fire correctly
- dispel playback/animation also became correct after the change

Observed working values for `Enervate`:

- `casterRuntimeId = 1021`
- `skillId = 1101`
- `levelIndex = 1`

So the `sub=0x04` opener/header was not fully correct before. The skill level byte was one of the protocol mismatches.

### Confirmed `sub=0x03` Runtime Shape

Live breakpoints in the real `sub=0x03` handler (`0x520c0c`) show that the generic hit path resolves multiple entity ids and result bytes before entering the final combat routine:

- Typical normal-hit resolution:
  - `CASE03_RESOLVE_A key=1021`
  - `CASE03_RESOLVE_B key=7340051`
  - `CASE03_RESOLVED objA=0x8e9e20 objB=0x8e9110 modeA=3 modeB=0 extraVal=0`

Meaning:

- `sub=0x03` resolves the player runtime id and the enemy runtime id directly into combat-side objects.
- This is the branch that carries real hit/kill semantics and is why forcing `sub=0x03` shows playback, even if it double-animates when combined with `sub=0x04`.

### Current `sub=0x04` Failure Point

The real `sub=0x04` handler does resolve past the cast header and into a target-side object path, but it lands on the wrong object family for effect/result playback.

Observed live values:

- `CASE04_BRANCH fight=0x681f6e0 skillSlot=1101 caster=1021 actorNode=0x8e9e20`
- `CASE04_AFTER_ACTOR actorNode=0x5fd8fd0 resolvedTargetOwner=0x48d9630 caster=1021 skillSlot=1101 levelIndex=0`

The effect gate then checks:

- `ownerInner = [resolvedTargetOwner + 0x1c]`
- required: `[ownerInner + 0x40] == 0x0a`

Observed live gate values:

- `CASE04_GATE owner=0x48d9630 ownerInner=0x4b365d8`
- `CASE04_GATE_TYPE inner=0x4b365d8 type40=8`

Because `type40 = 8` instead of `10`, the client skips the effect-result block that appears to be responsible for deeper skill impact behavior, including the still-missing red damage path.

### Wrong Target-Side Reference in `sub=0x04`

The current `sub=0x04` target-side path is resolving through the wrong reference value.

Observed live trace:

- `CASE04_ACTOR_RESOLVE key=1021 obj=0x48d9630 skillId=1101 lvl=0`
- `CASE04_ACTOR_NODE actorWrap=0x8e9e20 actorNode=0xa3fa20 ownerSlot=0x48d9630`
- `CASE04_OWNER_FETCH actorNode=0x5fd8fd0 ownerField2c44=0x1 targetObj=0x4c8e0f0`

Important finding:

- `ownerField2c44 = 0x1`

This means the downstream `sub=0x04` target-side lookup is not using a real enemy runtime/entity id at that point. It is effectively resolving through a tiny selector/slot-like value, which leads to the wrong type-`8` object family instead of the type-`10` combat object family needed by the skill effect gate.

### `0x03fa sub=0x06` Owns `+0x2c44`

The selector stored at `actorNode + 0x2c44` is programmed by the real `0x03fa sub=0x06` handler, not by `sub=0x04`.

Verified runtime handler:

- `sub=0x06` -> `0x51f985`

Observed live trace:

- `W2C44_ENTRY parser=0x917354 self=0x8e9110`
- `W2C44_SET selector=1 self=0x8e9110`

This is the same field later consumed by the skill path:

- `CASE04_OWNER_FETCH ... ownerField2c44=0x1 ...`

Implication:

- the current server `sub=0x06` round-start packet is almost certainly programming the selector with the wrong semantic value
- on current server builds, that value tracks a tiny integer (`1`, `2`, ...) instead of a target-side combat selector that resolves to the type-`10` object family
- because `sub=0x04` relies on `+0x2c44`, a malformed `sub=0x06` can break skill effect resolution even if `sub=0x04` itself is otherwise well-formed

### Current Best Theory

- `sub=0x06` is not just a visual round-start packet. It also initializes per-combat selector state used later by `sub=0x04`.
- The server currently sends `sub=0x06` with a field layout that causes the client to write `+0x2c44 = roundNumber` or another tiny placeholder-like value.
- That selector then sends `sub=0x04` through the wrong target-owner/object path, yielding `type40 = 8` instead of the required `10`.

### Next Patch Direction

Before changing `sub=0x04` again, decode and correct the server `sub=0x06` layout.

The verified client-side `sub=0x06` parse starts by reading and storing:

1. `u16` -> written directly to `+0x2c44`
2. `u32`
3. `u16`
4. `u8`
5. optional `u32` depending on the `u8`

So the existing server round-start packet (`round`, `activeEntity`, `0x0c`) is almost certainly under-specified/misaligned for the real client parser.

### Current Working Theory

- `sub=0x03` resolves the enemy runtime id directly and reaches the correct combat object family.
- `sub=0x04` header is correct, but the downstream target/effect section still drives the client into a target-owner/slot path that yields `type40 = 8`.
- The remaining protocol gap is therefore in the target-side portion of `sub=0x04`, not in the cast header.

### Next Debug Step

Do not change the `sub=0x04` header again.

The next useful comparison is:

- trace where the `0x2c44` field on the skill-side actor node is populated in normal combat flow
- compare that with the enemy runtime/object path used by `sub=0x03`
- then update the server-side skill target section so `sub=0x04` resolves to the same enemy combat object family as `sub=0x03`

## `0x040d` Action-State Reset

Client reference: `HandlePlayerActionStatePacket_040D`

Observed client-side prefix:

1. `entityId: u32`
2. `actionCode: u8`

Known reset:

- `actionCode = 'b' (0x62)` immediately clears one client action mode path via `SetGatherModeAndOptionallyNotify_0400(..., 0, 0)`.
- `actionCode = 'c' (0x63)` reads 11 `u16` values into an internal action-state table, then calls `SetGatherModeAndOptionallyNotify_0400(..., 1, 0)`.

Current server use:

- Send `0x040d` + `entityId` + `0x62` on combat intro, command refresh, and combat clear.
- Follow with `0x040d` + `entityId` + `0x63` + 11 zero `u16` entries to clear the client action-state table between battles.

## `0x03ed len=3 hex=ed0309` Combat Ready Event

Scope note:

- this section is about the client-originated combat control packet family that also uses opcode `0x03ed`
- it is separate from the world/entity smooth-movement handler at `0x504820`
- the world `0x03ed` path can carry extra entity-state payload after the movement dword when specific flag bits are set, so do not assume every `0x03ed` packet is a 1-byte combat subcommand

Observed runtime behavior:

- clients emit `0x03ed 0x09` after combat playback phases complete
- in shared team combat this is the primary event-driven hook for advancing the next AP-ordered queued action
- the server must consume that ready packet only for the currently expected acting session

Practical implications:

- consuming ready from the wrong session can make actions appear simultaneous or advance the shared queue too early
- if a queued actor is skipped because it died earlier in the same round, the server must advance explicitly instead of waiting for a ready packet that will never arrive
- if a queued target dies earlier in the same round, the action resolver should retarget or skip cleanly before the queue waits on readiness

## `0x03ed len=7 hex=ed030a????????` Combat Selector Token

Observed runtime behavior:

- the client sometimes emits `0x03ed sub=0x0a` during command phase with a `u32` payload
- the sender path is `0x49bdc0 case 6 -> QueueCombatSelectorTokenCommand -> FlushPendingCombatControlCommand`
- the payload is not a combat runtime id; it is a client-side selector token

Strong correlation:

- the `u32` from `0x03ed sub=0x0a` exactly matches the mysterious `u32` that appeared in older successful `0x03fa sub=0x06` packets
- the same `u32` also shows up in client-originated `0x03f5` skill/control packets such as `sub=0x51`, `sub=0x56`, and `sub=0x58`
- therefore the `sub=0x06` `u32` field is not an active entity id; `1021` only looked correct because some earlier simplified packets reused the local player runtime id there

Important constraint:

- the client `0x03ed` receiver treats `sub=0x0a` as a no-op
- so the server should not try to echo `0x03ed sub=0x0a` back to the client
- the useful action is to consume the token and feed it into the outbound round-control path

## `0x03f0` Skill Table Rebuild

Verified handler chain:

- `HandleFightTurnPacket_03F0 (0x5052a0)`
- `HandleCombatSkillTableRebuildPayload`
- `CombatSkillTable_RebuildFromPacket`

Observed behavior:

- `HandleCombatSkillTableRebuildPayload` reads a leading `u8` flag
- if the flag is non-zero, the handler returns without rebuilding anything
- if the flag is zero, it calls `CombatSkillTable_RebuildFromPacket` on the local player skill table

Verified rebuild semantics:

- `CombatSkillTable_RebuildFromPacket` starts by calling `CombatSkillTable_Clear`, which clears the entire live combat skill-object table
- it then reads `entryCount: u16`
- repeated entries are `u16/u16/u16`
- each entry is instantiated/imported through `CombatSkillTable_CreateEntryFromTemplate`

Practical implication:

- combat-time `0x03f0` is a full replacement rebuild, not a patch and not a narrow UI refresh
- full combat-time `0x03f0` replays passive/stat-bearing objects and can trigger ATK drift
- partial or filtered combat-time `0x03f0` is also wrong because the client treats it as replacement and drops missing skill objects

## `0x03e9 sub=0x03` Mapserver Progress Restore

Verified registration:

- `RegisterGamePacketHandlers` registers `0x03e9 -> HandleMapServerProgressPacket_03E9`
- `HandleMapServerProgressPacket_03E9` is a 25-case subcommand dispatcher
- `sub=0x03` is the local player restore path

Verified `sub=0x03` behavior:

- the handler logs `MAPSERVER INPROGRESS: 3-1` through `3-5`
- it explicitly calls `ClearLocalCombatRuntimeState (0x434070)` before restoring local player fields
- it then calls `RestoreLocalPlayerFromMapServerProgress (0x436930)`, which reads:
  - `u32 runtimeId`
  - `u16 roleEntityType`
  - `u32 roleData`
  - `u16 x`
  - `u16 y`
  - `u16 reserved`
  - `string name`
  - `u8 extraNameFlag`
  - optional extra string when the flag is non-zero

Practical implication:

- post-combat client cleanup is not only a fight-stream concern
- the client’s real combat-exit clear path is entered through `0x03e9 sub=0x03`
- because that path clears the live combat skill table before reading the restore payload, omitting this packet can leave the last offensive skill’s reuse gate resident into the next battle

Current server takeaway:

- the existing login / enter-game success packet already matches the required field layout closely enough
- a narrow `0x03e9 sub=0x03` restore alone is not sufficient in practice: it clears combat skill state, but the client also needs the normal post-login rehydrate layers for inventory, equipment-derived stats, pet state, and related UI state
- the practical server fix is to run the full runtime bootstrap after combat exit (`sendEnterGameOk({ syncMode: 'runtime' })`), using `0x03e9 sub=0x03` as part of that broader restore path rather than as a standalone packet
- ordering matters: the server must clear its combat state first, then send the runtime bootstrap, otherwise the client can apply only part of the restore and leave inventory / stats / UI in a mixed combat state

## Offensive Skill Disable Root Cause

The client computes offensive-skill availability locally.

Relevant pieces:

- the combat menu validator lives at `CombatSkillRuntime_CheckReuseBlocked (0x54a850)`
- the cast-time overlay lives at `CombatSkillRuntime_ApplyCastSelector (0x54a990)`
- the template import path lives at `CombatSkillRuntime_InitFromTemplate (0x54aa90)`

Relevant live-object fields:

- `+0x170`: actor/runtime id gate
- `+0x174`: selector gate
- `+0xd0`, `+0x38`: additional selector threshold terms

Observed validator rule:

- if `skillObj+0x170 == argActor`
- and `argSelector < skillObj+0x174 + skillObj+0xd0 + skillObj+0x38`
- then the validator returns error `4` and the offensive skill is greyed out

Observed behavior:

- self-buffs such as `Defiant` bypass this because their live object keeps `+0x170 = -1`
- offensive skills such as `Enervate` get marked with actor/selector state after cast and then fail the same validator next round unless the selector state is refreshed correctly

## `0x03fa sub=0x06` Round-Control Layout

The real `sub=0x06` handler (`0x51f985`) parses:

1. `u16` -> visible round/banner value
2. `u32` -> selector token written into later skill-resolution state
3. `u16`
4. `u8`
5. optional `u32` depending on the `u8`

Important corrections:

- the first `u16` must stay the real round number
- the second field is a selector token, not the acting runtime id
- `EnterCombatModeAndResetSelectorState (0x518a10)` seeds local selector state to `1`, so the client has a fallback before it receives a server-driven token

## Current Corrective Direction

The correct fix is no longer "send `0x03f0` on command rebuild".

Current best model:

1. keep `0x03f0` for login/out-of-combat skill-table sync only
2. consume client `0x03ed sub=0x0a <selectorToken>`
3. thread that selector token into the `u32` field of outbound `0x03fa sub=0x06`
4. keep `0x03fa sub=0x04` for cast playback and `0x03fa sub=0x03` for hit-resolution where needed

Why this is the most defensible model:

- it matches the client sender state machine instead of fighting it
- it explains why `0x03f0` "worked" while also causing ATK drift and skill loss
- it explains the older good traces where a second `sub=0x06` used a non-runtime selector token like `0x07db693e`
- it matches the fact that `sub=0x04` later consumes selector state through the `+0x2c44` family instead of resolving the target purely from the flat cast header

Open point:

- in multi-actor traces, the client sometimes received multiple `sub=0x06` packets per round with different selector tokens
- so the final server implementation may need a round-control packet combination, not just one packet
- the key boundary is still the same: fix selector-token flow, not combat-time skill-table rebuild

## Failed Packet Probes

The following server-side `sub=0x04` experiments were all accepted by the client but did not unlock red damage playback:

1. Flat target entity overridden to `targetIdLo`
   - example wire target became `2:3:95`
2. Flat `targetAction` forced to `0`
   - example wire target became `7340034:0:93`
3. Flat `targetValue` forced to `0`
   - behavior stayed unchanged
4. Two-entry stage-2 tail:
   - entry 1: `skillId,targetAction,targetValue`
   - entry 2: `targetIdLo,targetAction,targetValue`

Example two-entry packet:

- `fa 03 04 fd 03 00 00 4d 04 00 01 00 70 00 03 5f 00 00 00 00 02 00 4d 04 03 00 5f 00 00 00 01 00 03 00 5f 00 00 00`

Current implication:

- the missing semantics are not in the simple flat target triplet alone
- the missing semantics are also not solved by a trivial one-entry or two-entry `u16/u16/u32` stage-2 tail
- the remaining protocol gap is likely a different target-side semantic in `sub=0x04`, or another client-side prerequisite event/state before damage UI is emitted
