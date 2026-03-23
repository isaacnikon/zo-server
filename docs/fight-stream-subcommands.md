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

Observed second-stage client parse:

- Caller `0x431a40` reads a leading `u8` flag with `0x589210`.
- If that flag is non-zero, the branch returns early and does not enter the skill-entry parser.
- If that flag is zero, it calls `0x54ce10`.
- `0x54ce10` reads:
  1. `entryCount: u16`
  2. repeated entries:
  3. `entryWordA: u16`
  4. `entryWordB: u16`
  5. `entryDwordC: u32`
- The repeated entry parser uses `0x589240`, `0x589240`, then `0x589270`, so this stage is definitively `u16/u16/u32`, not `u32/u8/u32`.
- `0x54ce10` passes those three values into `0x54cd70`, which then stores `entryWordA` via `0x54afa0` and mirrors internal fields via `0x54a660`.
- The floating skill-damage renderer around `0x437954..0x437b39` is downstream of a different object state and is not reached by the current server packet shape.

Observed behavior in client handler:

- `targetActionCode=1` -> normal successful skill hit path
- `targetActionCode=3` -> lethal/kill path branches
- Self-buff style skill casts can use `0`

Current server implication:

- For skills, send `sub=0x04` first to start the skill animation path.
- Follow with `sub=0x03` only for actual hit/damage resolution if the skill deals damage.
- Do not assume `sub=0x04` carries per-target damage in the same flat record. The client has an additional parsed structure after the cast header, and that structure is still only partially decoded.

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

Observed live values for `Enervate`:

- `casterRuntimeId = 1021`
- `skillId = 1101`
- `levelIndex = 0`

So the remaining bug is not in the `sub=0x04` opener/header.

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

## Targeting Notes

- The client computes offensive-skill availability locally in `FUN_00413670`.
- In the combat skill menu builder (`FUN_0047af60`), the returned `AL` value is written directly into the entry enabled/disabled flag.

## `Enervate` Disable Root Cause

The round-2 disable was traced to the `Enervate` skill object validator at `0x54a850`.

Relevant fields on the live `Enervate` object:

- `+0x170`: actor/runtime id gate
- `+0x174`: selector gate
- `+0xd0`, `+0x38`: additional selector threshold terms

Validator rule:

- if `skillObj+0x170 == argActor`
- and `argSelector < skillObj+0x174 + skillObj+0xd0 + skillObj+0x38`
- then return `error 4`

Live object comparison:

- `Enervate` skill object: `0x4c8e0f0`
- `Defiant` skill object: `0x4c8df70`

Observed behavior:

- `Defiant` bypasses the actor-match gate because `+0x170 = -1`
- `Enervate` is marked with the current actor id and selector after cast, so it fails the same validator on the next round unless the client gets a fresh skill-state sync

## `Enervate` Rebuild Path

The client rebuilds the live `Enervate` object in two separate steps:

1. Copy/import from a source skill-state object:
   - `0x54aa90` entered from `0x54cdb0`
   - source object observed: `0x48d9630`
2. Overlay actor/selector state from the live `sub=0x04` skill-cast handler:
   - `0x54a990` entered from `0x52028d`
   - observed values: `actor=1021`, `sel=5`

Important implication:

- the trailing stage-2 `u32` in `sub=0x04` is not the source of the round-2 disable
- `0x54afa0` only writes a `u16` into `skillObj+0x18`
- the disable happens because `sub=0x04` overlays the live skill object with actor/selector state, and that state later trips `0x54a850`

## Working Server Fix

Resending `0x03f0` skill state sync at command-phase refresh fixes the round-2 disable:

- `reason=combat-command-client-ready`
- `reason=combat-command-enemy-counterattack-normal`
- `reason=combat-command-enemy-counterattack-post-kill`

This keeps `Enervate` enabled across rounds without needing the old hybrid `sub=0x03` impact packet.

Important follow-up:

- `0x03fa sub=0x06 fieldA` is also the visible round-banner value in the client UI.
- Using selector probes like `fieldA=5` makes the client render `Round 5` even when the real encounter round is `1`.
- So the working server fix is:
  - keep the extra `0x03f0` refresh
  - keep hybrid skill impact off by default
  - keep `sub=0x06 fieldA` equal to the real round number
- Do not reuse `fieldA` for selector experimentation.

## Current Remaining Bug

After the `0x03f0` refresh fix:

- `Enervate` stays enabled after round transition
- hybrid `sub=0x03` skill impact can remain disabled, so double animation is gone
- damage text is still missing

Current packet sequence in the good state:

- `0x03f0` skill state refresh on command rebuild
- `0x03fa sub=0x04` for the skill cast
- no additional skill-specific `0x03fa sub=0x03`

So the remaining issue is now isolated:

- the missing red damage is a pure `sub=0x04` client playback/decode problem
- it is no longer entangled with the round-2 skill-disable bug
- the round banner regression from the probe was self-inflicted by overriding `sub=0x06 fieldA`, not by the real round counter
- Observed breakpoint result in the failing second-fight case:
  - `skillId=1101 (Enervate) -> enabled=0`
  - `skillId=3103 (Defiant) -> enabled=1`
- Self-buffs and offensive skills therefore do not share the same client gate.
- A likely failure mode is stale combat-target state carried across encounters. Reusing the same enemy runtime IDs across fights is unsafe because the client appears to cache targetability for offensive-skill validation.

## Latest `sub=0x04` Gate Result

With the round-refresh fix active and hybrid impact disabled, the client still takes the same early `sub=0x04` path and bails before the deeper effect block:

- `0x52028d` apply/overlay:
  - `esi=0x4c8e0f0`
  - `ebp=0x5fd8fd0`
- `0x52034c` early gate:
  - `eax=0x4b365d8`
  - `edx=0x48d9630`
  - `esi=0x8e9110`
  - `ebp=0x5fd8fd0`
- `0x520370` and `0x52038d` did not fire

Current implication:

- the client still exits before the deeper `0x43d1b0` call / effect block
- the remaining missing-damage bug is still upstream of the effect block
- round-state and hybrid-animation issues are no longer part of this bug

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
