# PvP And Team UI Context

Source of truth for these notes is the client binary `gc12.exe` in Ghidra, not the dumped server source.

## Packet Registration Hub

Client packet registration is centered at `0x514c00`.

Relevant mappings from that table:

- `0x0400 -> 0x504440`
- `0x0402 -> 0x505be0`
- `0x0403 -> 0x504840`
- `0x03fa -> 0x504b70`
- `0x03fb -> 0x504c90`

Important nearby world/entity mappings for context:

- `0x03eb -> 0x5047e0` (`HandleEntitySpawnPacket03EB`)
- `0x03ed -> 0x504820` (smooth entity movement)
- `0x03f9 -> 0x505300` (position correction / snap)

## PvP / Non-Combat UI

### `0x0400` at `0x504440`

Wrapper:

- `HandleNonCombatPacket_0400` at `0x504440`
- dispatches into `FUN_005028a0`

`FUN_005028a0` currently looks like a non-combat social / video-chat style UI handler, not combat simulation:

- reads `u8 subcmd`
- reads `u32 actorId`
- for all subcommands except `0x03`, also reads a second `u32`
- resolves the actor through `FUN_00502540`

Observed subcommands:

- `0x01`: incoming request UI
  - builds dialog text like `Require VideoChat`
  - uses accept / refuse buttons
- `0x02`: request accepted
  - shows `agrees VideoChat`
  - stores peer ids into client state at `this+0x194` / `this+0x198`
  - attempts to start the session via `FUN_00502300`
- `0x03`: request refused
  - shows `refuse VideoChat`

Takeaway:

- `0x0400` is a non-combat interaction UI handler
- if we revisit PvP/social prompts later, start at `FUN_005028a0`

### `0x0403` at `0x504840`

Wrapper:

- `FUN_00504840` at `0x504840`

This looks like a PvP / escort / robbery notice handler with several small UI cases.

Observed subcommands:

- `0x01`
  - reads a `u32`
  - then loops over `u16/u16/string-ish` style entries
  - calls `FUN_004f38c0(...)`
  - likely some ranking / feed / notice list update
- `0x05`
  - reads one value and calls `FUN_004e3eb0(...)`
- `0x0c`
  - dialog: `You have reached max. kill amount!`
- `0x0d`
  - dialog: `Can not kill! A member's level of the other side is low!`
- `0x10`
  - dialog: `Enough Robbery. Can not rob escorted goods any more today.`
- `0x11`
  - dialog: `Their escorting times is full. Can not rob any more!`
- `0x58`, `0x59`, `0x5a`
  - read a value, set `DAT_008e90e2`, call `FUN_004efde0(...)`
  - likely related to a follow-up PvP / robbery action flow

Takeaway:

- `0x0403` is the main place to continue for PvP warning dialogs and escort/robbery UI behavior

## Team UI

### `0x0402` at `0x505be0`

Wrapper:

- `FUN_00505be0` at `0x505be0`

This is the main team UI / membership state handler.

High-level behavior:

- reads `u8 subcmd`
- heavily manipulates `DAT_00907a00`, which is the client team-state structure
- emits many system messages through `FUN_0040f1c0(...)`
- updates teammate status flags at offset `+0x67c`

Observed subcommands from the decompiled cases we reviewed:

- `0x01`
  - reinitializes the team structure
  - inserts the local player into the team state
- `0x02`
  - reads ids / values and calls `FUN_004a5e90(...)`
  - likely team invitation / application style state
- `0x04`
  - shows `refused to enter game`
- `0x05`
  - removes a member from team state via `FUN_00557860(...)`
- `0x06`
  - updates some team list / UI cache through `FUN_00442f90(...)` and `FUN_004a3920(...)`
- `0x07`
  - system message: `Team dismissed!`
  - frees the team structure
- `0x08`
  - allocates / initializes team state if absent
- `0x09`
  - calls `FUN_00557600(...)`
  - then emits a secondary packet `0x0442 sub=0x0c`
  - finishes with `You team status updated!`
- `0x0a`
  - system message: `He/she has joined the team!`
- `0x0d`
  - member became new leader
- `0x0e`
  - leader removed a member from team
- `0x12`
  - dialog: `Team is full Tip` / `There is a team!`
- `0x14`
  - removes a member entry via `FUN_00557930(...)`
- `0x15`
  - member left temporarily
- `0x16`
  - member returned to team
- `0x17`
  - reads an entity id and coordinates
  - if the map matches, updates that entity position via `FUN_00432d40(...)`
  - this is important if we ever need team-follow / teammate marker sync
- `0xd3`
  - dialog: `You're not at the same map as your teammates! Team failure!`
- `0xd4`
  - dialog: `You're too far away from the team! Team failure!`

Takeaway:

- `0x0402` is the main team-state and team-message UI handler
- start at `FUN_00505be0`
- use `DAT_00907a00` as the anchor when tracing client team behavior

## Combat / World Separation Note

This matters for later packet work:

- `0x03fa` is handled by `HandleCombatCommandPacket_03FA` at `0x51f5e0`
- it is combat-only
- the `0x03fa/0x33` hide path should not be assumed to despawn world scene entities

Related world/entity handlers:

- `0x03eb` spawn handler only recognizes subtypes `0x01`, `0x02`, and `0x15`
- `0x03ed` is the smooth movement path
- `0x03f9` is the correction/snap path

This is relevant because stale world players/pets are likely blocked on finding the real non-combat despawn opcode, not on team/combat UI behavior.

## Good Restart Points

When we come back to this area later, start from:

- registration table at `0x514c00`
- `FUN_005028a0` for non-combat / request UI
- `FUN_00504840` for PvP / escort / robbery warnings
- `FUN_00505be0` for team membership, leader changes, and team notices
