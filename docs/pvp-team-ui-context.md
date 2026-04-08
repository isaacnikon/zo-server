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
  - calls `FUN_00557600(...)`
  - then emits a secondary packet `0x0442 sub=0x0c`
  - finishes with `You team status updated!`
- `0x09`
  - system message: `He/she has joined the team!`
- `0x0d`
  - explicit leader-change packet
  - member became new leader
  - resolves the leader through `FUN_00557580(...)` using the member record field at `+0x1dc`
  - updates `DAT_00907a00[2]`
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

Additional verified findings from the latest team work:

- Outbound team action `0x03fe sub=0x06` is not the same thing as inbound team UI packet `0x0402 sub=0x06`.
- Client function `FUN_004a23b0(...)` sends `0x03fe sub=0x06` with the clicked target runtime id when the player uses the order-menu "apply to team" action on someone who is already in a team.
- Practical server consequence: inbound `0x03fe sub=0x06` cannot be treated as decline-only. If it carries a live target and there is no matching pending interaction, it is an apply-to-join request and should route through normal join-request handling.
- `FUN_00557600(...)` is the full 5-slot team roster loader.
- The roster packet layout parsed by `FUN_00442f90(...)` is:
  - `u32` -> member live entity/runtime id at `+0x5b0`
  - `u16` -> role entity type at `+0x40`
  - `u16` -> level at `+0x260`
  - `u32` -> stable member identity at `+0x1dc`
  - `u8` -> member status at `+0x67c`
  - `string` -> display name
- The leading `u32` in the full roster packet is matched against the roster entry field at `+0x1dc`, not `+0x5b0`.
- `0x0402 sub=0x0d` leader change also uses that same `+0x1dc` identity field.
- `0x03ed`/`0x03f9` movement and `0x0402 sub=0x17` teammate position use live runtime ids, not the stable team identity field.
- For server work this means team membership packets need a stable identity distinct from movement/runtime ids.
- Even though the client loader iterates a 5-slot structure, our current server runtime must keep `0x0402 sub=0x08` roster sync sparse and send only live members.
- Padding the remaining roster slots back out to all 5 entries regresses invite flow and prevents inviting or accepting the second member reliably.
- `0x0402 sub=0x01` inserts the local player into the local team object with status `1`; using it on invite accept can distort member-side captain state if the roster already carries correct identities.
- `0x0402 sub=0x06` is not a safe generic member-refresh packet on this client. It runs through a separate insertion path and can duplicate applicant entries if replayed broadly during normal team resync.
- The client helper `FUN_00557800(...)` chooses a fallback captain by scanning for the first member whose status byte `+0x67c` is `1`.
- A status of `0` on roster entries renders as offline/unset in the team UI; `1` is the normal active state; `2` is the temporary-leave style state.
- The client is still not emitting the expected `0x0442 sub=0x0c` follow-up in our current flow.
- `0x0402` team packets update the local team object (`DAT_00907a00`) and mirror status back onto the local player entity, but they do not by themselves populate captain state on other visible world entities.
- `0x03eb` player spawn (`FUN_00436e80`) preserves the three appearance-flag bytes into entity offsets `+0x5de..+0x5e0`.
- The world/entity state updater at `FUN_00435f10(...)` reads `x`, `y`, and the packed entity-state dword into `+0x4c`; when bit `0x10` is present it also reads a `u32` into `+0xf5c` and then a `u8` into `+0x67c`.
- `SceneScript_RunBySceneAndId(...)` uses `+0xf5c` and `+0x67c` together with the local team object to derive remote teammate state (`+0xf18`), which is the relevant path for the visible captain marker on non-leader sessions.
- Practical server consequence: the captain indicator for other players must be broadcast through remote world-entity sync (`0x03eb` / `0x03ed`), not only through `0x0402 sub=0x08` and `0x0402 sub=0x0d`.
- Clearing that state is not purely incremental on the client side; when team topology changes, forcing a visible-player respawn / refresh is the safest way to clear stale captain state on nearby viewers.

Current practical state:

- roster population works
- team invite / accept / leader flow works
- sparse roster serialization is intentional because full 5-slot padding breaks the second-member invite path
- same-map leader movement / follower movement works
- member-side captain badge now appears when leader linkage is sent through remote world sync
- `0x0402` roster / leader packets are still required for team UI correctness, but they were not sufficient for the visible world captain marker
- the working server-side fix is: keep sparse `0x0402 sub=0x08`, keep `0x0402 sub=0x0d`, and additionally refresh nearby world entities with the leader-linked `0x03ed` state payload

## Shared Team Combat Findings

Additional verified findings from the latest team combat work:

- Team combat now works best as one owner-driven shared round, not as mirrored independent battles.
- The leader-side session should own the shared combat state and enemy roster, while followers receive mirrored playback and local command prompts.
- Player selections must be queued per round before any shared round begins.
- Those queued selections need to be tagged with the exact combat round number; otherwise stale inputs from a previous round can incorrectly satisfy "everyone is ready" for the next round.
- The runnable round should be built from one AP-sorted list containing:
  - all active living team participants with a queued action for the current round
  - all living enemies
- Dead or invalid queued actors must explicitly advance to the next action instead of returning early, or the shared round can deadlock.
- If an earlier action kills an enemy that still appears later in the AP queue, that later enemy entry must be skipped and the queue must continue.
- If a queued player action targets an enemy that died earlier in the same round, server resolution should retarget to a random living enemy rather than no-op on the dead explicit target.
- Follower disconnects during shared combat should remove only that participant from the owner's shared-combat participant set, not tear down the full shared combat unless the owner disconnects.

Practical server-side consequences:

- shared rounds should only finish after all queued actions and remaining living enemy actions have been consumed
- `clearCombatState()` on a follower must not destroy the entire shared combat mapping
- queued item / defend / skill / attack actions all need to obey the same round queue constraints

Observed remaining risk area:

- visible sequencing still depends on the client completion/ready packets arriving in the expected order; the server should not silently fall back to blind timer-only advancement for shared rounds

## Combat / World Separation Note

This matters for later packet work:

- `0x03fa` is handled by `HandleCombatCommandPacket_03FA` at `0x51f5e0`
- it is combat-only
- the `0x03fa/0x33` hide path should not be assumed to despawn world scene entities

Related world/entity handlers:

- `0x03eb` spawn handler only recognizes subtypes `0x01`, `0x02`, and `0x15`
- `0x03ed` is the smooth movement path
- `0x03f9` is the correction/snap path
- world `0x03ed` can carry extra payload beyond position:
  - bit `0x10` in the packed state dword adds `u32 -> +0xf5c` and `u8 -> +0x67c`
  - bit `0x40000` adds an extra `u16 -> +0xd94`

This is relevant because stale world players/pets are likely blocked on finding the real non-combat despawn opcode, not on team/combat UI behavior.

## Good Restart Points

When we come back to this area later, start from:

- registration table at `0x514c00`
- `FUN_005028a0` for non-combat / request UI
- `FUN_00504840` for PvP / escort / robbery warnings
- `FUN_00505be0` for team membership, leader changes, and team notices
- `FUN_00435f10` for world-entity state updates from `0x03ed`
- `SceneScript_RunBySceneAndId(...)` for the post-update remote-player marker / linkage behavior
