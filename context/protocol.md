# Protocol Notes

## Client and Config
- Client root: `/home/nikon/Data/Zodiac Online/`
- Main executable: `gc12.exe`
- Login DLL: `Login.dll`
- Local dev server config points to `127.0.0.1`

## Packet Format
Offset layout:

```text
0:  flags
1:  u16 payload_len
3:  u16 sequence
5:  payload
```

- Valid flags satisfy `(flags & 0xE0) == 0x40`
- Sequence starts at `0`, wraps after `65000` to `1`

## Packet Flags
- `0x01`: XOR encrypted
- `0x02`: compressed
- `0x04`: special/control packet

## Encryption
- Transport uses XOR, not AES
- XOR key is derived from server seed
- Seed `0` disables XOR

## Handshake
First packet from server:

```text
flags=0x44
payload: u16 cmd=1, u32 seed
```

Special/control packets:
- `cmd=1`: handshake
- `cmd=2`: client ping
- `cmd=3`: server pong

## Login Flow
- Login packet is `0x03e9 + username + MD5(password) + 'S'`
- Session 1 is login
- Session 2 is game
- Real login->game handoff is `0x03e9 / 0x0d`
- Enter-game success is `0x03e9 / 0x03`

## Important Game Packets
- `0x03eb`
  Position/map/entity query family. Client also sends current `x/y/mapId`.
- `0x03fa`
  Fight stream family. This is the main combat-state packet dispatcher.
- `0x03f0`
  Fight turn/round family.
- `0x03f1`
  Server-run/message family. Client uses it for travel/script requests.
- `0x03f6`
  Active entity state updates. Subtype `0x0a` applies aptitude.
- `0x0407`
  Client-side executor for `script\\serverrun\\%d.lua`

## Confirmed Combat Packet Behavior
- `0x03fa / 0x65`
  Fight-enter packet. The client enters combat mode from this path and calls `EnterFightMode`.
- `0x03fa / 0x66`
  Does not dispatch next to `0x65`. It has its own branch at `0x00520f3e`, and it is a structured fight-state/control packet rather than a minimal fight-exit toggle.
- `0x03fa / 0x34`
  Opens or refreshes the `FIGHTCONTROL` UI.
- `0x03fa / 0x02`
  Takes no payload. This low-numbered control branch resets fight-control state and runs the `FIGHTCONTROL` open/refresh macro path.
- `0x03fa / 0x03`
  Is a structured active-slot state packet. It toggles board-slot mode through `FUN_00516750` and is a better startup candidate than the result/status handlers.
- `0x03fa / 0x33`
  Takes a single `u32` entity id. It looks up the fight entity, then triggers additional per-entity UI/state refresh work.
- `0x03fa / 0x68`
  Takes a single `u32` entity id. It marks a per-entity fight-control flag (`+0x83 = 1`) after lookup.
- `0x03fa / 0x67`
  Is a control-state packet in the same family as `0x66`, not a simple entity-id flag packet.
- `0x03fa / 0x0a`
  Is a repeated per-entity state-sync packet. It updates fighter fields and then runs a board-wide rescan.
- `0x03f0`
  Is not sufficient to start combat by itself. It is processed after fight mode already exists, and the payload is structured rather than arbitrary.
- `0x03ec`
  Is not a reliable generic "fight started" signal. It also carries unrelated status/UI notifications.

### `0x03fa / 0x65` Payload Shape
Confirmed from `DispatchFightStream03fa`:

```text
u32 active_entity_id
repeat until payload end:
  u8  side
  u32 entity_id
  u16 type_id
  u8  row
  u8  col
  u32 hp_like
  u32 mp_like
  u8  aptitude
  u16 level_like
  repeat 3 times:
    u16 appearance_type
    u8  appearance_variant
  string name   // u16 byte length + bytes, must include a trailing NUL
```

Notes:
- `0x02` is in the small direct jump table for subcommands `0x02..0x0e`, not the larger `'1'..'|'` table.
- The branch at `0x0052289c` does not read packet body fields.
- It resets multiple fight-control globals/flags, calls into `FIGHTCONTROL`, and executes the embedded script string:
  `macro_GuiSetWinVisable("FIGHTCONTROL", 1) macro_GuiSetWinOpenClose("NPCKICK") ...`
- Current server experiment:
  send a bare `0x03fa / 0x02` immediately after `0x65` as a possible action-wheel/control initialization trigger.

### `0x03fa / 0x03` Payload Shape
Confirmed from `DispatchFightStream03fa` and `FUN_00516750`:

```text
u32 entity_id
u8  enabled_flag
if looked-up board object type == 1:
  u32 state_e8
  u32 state_ec
  u32 state_f0
else if looked-up board object type == 2:
  u32 state_f4
  u32 state_f8
  u32 state_fc
u32 linked_entity_id
if linked_entity_id > 0 and lookup succeeds:
  if linked entity object exists:
    u32 state_f4
    u32 state_f8
    u32 state_fc
```

Confirmed semantics:
- The final slot toggle goes through `FUN_00516750(slot_index, enabled_flag)`.
- `FUN_00516750` maps the slot index into the 3x5 combat grid and calls `FUN_005166e0(...)`.
- `FUN_005166e0` writes board-slot state `6` when `enabled_flag != 0` and `7` when `enabled_flag == 0`.
- This makes `0x03` the first confirmed startup-adjacent packet that directly changes active combat-slot mode, which is why the server now probes it immediately after `0x02`.
- Current synthetic probe assumption:
  the active player object will take one of the `type == 1` or `type == 2` branches, so the server currently sends three zeroed state dwords plus `linked_entity_id = 0`.

### `0x03fa / 0x0a` Payload Shape
Confirmed from `DispatchFightStream03fa`:

```text
repeat until payload end:
  u32 entity_id
  u32 state_4c
  u32 hp_like
  u32 mp_like
```

Confirmed semantics:
- For each row, the client looks up the combatant by `entity_id`.
- When found, it writes:
  - `object + 0x4c = state_4c`
  - `object + 0x20c = hp_like`
  - `object + 0x210 = mp_like`
- After the packet, the client rescans the full 3x5 combat grid on both sides and updates per-slot board state for dead/empty entries.
- Current server experiment:
  send a minimal two-row `0x0a` immediately after `0x03`, covering the active player and the synthetic enemy, to seed the board state before `0x68/0x33/0x34/0x03f0`.
- Live result:
  adding the two-row `0x0a` changed behavior materially. The client played a default combat animation and, for the first time in this synthetic flow, sent an inbound combat packet: `0x03ed` with a one-byte body `0x09`.
- Practical implication:
  encounter initialization is now further along. The remaining blocker looks more like command-wheel population than raw combatant/state creation.
- UI implication:
  current RE shows `0x03f0` is not the whole top-level ring mechanism. `FIGHTCONTROL.skill` only populates the skill submenu after combat is already active; the top-level attack/defend/skill/run ring is likely driven by separate `FIGHTCONTROL` handlers or the `macro_SetFightAttack*` path.
- Ring-state implication:
  newer RE shows the top-level combat wheel is gated by a client action-mode field at `GetGameObject() + 0x3bbc`.
  The client fight command helpers repeatedly use:
  - clear pending state
  - call `FUN_00519a20()`
  - if it returns `0`, set their pending-command flag and then set `GetGameObject()->3bbc = 1`
  This makes `3bbc = 1` the strongest confirmed "show command selection" state so far.
- Important correction:
  `0x03f0` creates action objects, but current RE does not support the earlier assumption that it directly paints the outer attack/defend/skill/run wheel by itself.
  The wheel appears to depend on the client entering the same pending-command state that its own fight helpers use.
- `0x03ed / 0x09` live result:
  after adding `0x03fa / 0x0a`, the client sent its first inbound combat packet in the synthetic flow: `0x03ed` with body `0x09`.
  That packet is now a stronger candidate for the missing order-selection handshake than any remaining blind `0x03f0` row tweak.
  The server now defers its synthetic `0x03f0` turn packet until this exact client packet arrives, so the next tests can validate whether `0x03ed / 0x09` is the gate to the combat ring.
  Live test result: the handshake ordering is correct enough for the client to accept the delayed `0x03f0`, but the ring still does not appear, and the client shows `Combat: Summon pet failed!`. That strongly suggests the current `0x03f0` rows `5001..5006` are real actions in the wrong family, likely summon-pet actions rather than top-level command-ring actions.
- Important switch-table correction:
  the `DispatchFightStream03fa` jump table was previously misaligned for the `0x63..0x69` range.
  The corrected mapping shows:
  - `0x63 -> 0x005222ea` and this is the real combatant-entry / fight-start row parser
  - `0x64 -> 0x00520f3e`
  - `0x65 -> 0x005211c0`
  - `0x66 -> 0x00522a9d`
  - `0x67 -> 0x00522ae2`
  - `0x68 -> 0x005216a5`
  - `0x69 -> 0x00521afc`
  - `0x6a -> 0x005216bb`
  - `0x6b -> 0x00521aeb`
  - `0x6c -> 0x0052168f`
  This invalidates the older assumption that `0x65` was the fight-entry packet.
- `0x03fa / 0x0a` correction:
  `0x0a` is not a safe per-fighter stat-sync packet.
  Its branch at `0x0052125a` is tied to summon-pet flow and can produce the strings `Start to summon pet!`, `Summon pet failed!`, and related pet-entry failures.
  The server harness should not send `0x0a` as generic combat startup state.
- Harness correction:
  live testing showed `0x03fa / 0x63` by itself does not enter combat in the current synthetic harness.
  The server probe has therefore been moved back to `0x03fa / 0x65` as the last known-good live entry trigger, while still keeping `0x0a` and `0x68` removed from generic startup.
  Current interpretation: `0x63` may still be the row parser in the client, but it is not sufficient by itself for synthetic startup, or the `0x63..0x69` mapping still has an unresolved dependency.
- New startup hypothesis:
  `0x03fa / 0x64` is now the strongest next candidate companion packet.
  Its branch sets the fight-manager mode field to `1`, while the current live entry path `0x65` lands in mode `2`.
  The server now sends a minimal structured `0x64` immediately after `0x65` with:
  - `u32 stateA = 0xffffffff`
  - `u32 stateB = 0`
  - `u32 stateC = 0`
  This is intended to trigger the branch's compact control-state path without the optional extra fields.
- Live UI clue from double-click:
### 2026-03-16 Multi-Enemy `0x03fa / 0x65` Parse Findings

- Live client debugging of `/home/nikon/Data/Zodiac Online/gc12.exe` identified the `Combat data error!` popup path at `0x005227db -> 0x00522809`.
- The popup is raised when the client falls through instead of taking the success call to `0x00519bf0`.
- `0x00519bf0` validates the board-placement tuple used for a fighter record. From live disassembly:
  - first signed byte must satisfy `0 <= value < 3`
  - third signed byte must satisfy `0 <= value < 5`
  - side/mode handling only accepts the expected values (`1` or `-1` branch)
- At the breakpoint during broken 2-enemy startup, the client had decoded:
  - `col = 3`
  - `row = 2`
  - `side = 0x78`
- `0x78` is decimal `120`, matching the synthetic enemy HP. This proved the second fighter record was misaligned and the client was reading the side byte from the previous row's HP field.
- Tracing the same client parser backward from `0x005223d0` showed that the `0x03fa / 0x65` fighter rows are not all the same shape:
  - active player row: base fields plus an extended tail
  - non-player rows: base fields only
- Practical implication for the local harness:
  - only the player row should be serialized with the extended tail (`appearanceTypes`, `appearanceVariants`, and trailing name block)
  - enemy rows should stop after the base fields
- This explains the old behavior:
  - single-enemy startup tolerated the bad enemy-row tail because it sat at packet end
  - multi-enemy startup shifted the second row and triggered `Combat data error!`
- Current local patch:
  - player row is written with `extended: true`
  - enemy rows are written in short/base form
- Immediate live result after this patch:
  - the old popup path was not reached in the same way, but the startup UI froze
  - therefore the row-shape mismatch is real, but additional multi-enemy startup/control-state work is still required before multi-enemy startup is considered solved
  double-clicking the enemy during the synthetic fight now triggers the client dialog:
  `You are not in battle. You can not give orders!`
  This is important because it proves the click/attack handler is firing, but the client's own command helper still believes the active entity is not registered in a valid fight-command state.
  The top-level issue is therefore not only "ring missing"; it is also that the active player is not fully recognized by the client as being able to issue combat orders.
- New strongest ring candidate:
  `0x03fa / 0x01` is now the strongest startup companion packet.
  Its branch first checks that the active entity is present in the fight-slot table via `FUN_00515cf0(activeEntity->5b0)`, then drives the `FIGHTCONTROL` macro path and explicitly sets `GetGameObject()->0x3bbc = 1`.
  That is the clearest incoming-packet path to top-level command-ring activation found so far.
  The server now sends a bare `0x03fa / 0x01` immediately after `0x65`.
- Likely root cause now:
  the failure looks less like a missing UI toggle and more like a bad fighter identity.
  The client order helpers call `FUN_00515cf0(activeEntity->5b0)` to find the active player in the fight table.
  Our synthetic server currently writes `this.entityType` into the fight entry `entityId` field, which is likely conflating template/type with the runtime combatant id the client stores at `+0x5b0`.
  That would explain all three live symptoms:
  - fight scene opens
  - the ring does not appear
  - double-clicking an enemy says `You are not in battle. You can not give orders!`
- Enter-game packet layout:
  `ReadEntityFromPacket` at `0x00436930` reads the local player object in this exact order:
  - `u32 -> activeEntity + 0x5b0`
  - `u16 -> activeEntity + 0x40`
  - `u32 -> activeEntity + 0x1dc`
  - `u16 -> activeEntity + 0x5b4`
  - `u16 -> activeEntity + 0x5b6`
  - `u16 -> stack temp`
  - length-prefixed string -> activeEntity name
  - `u8 -> activeEntity + 0xd64`
  - optional length-prefixed string -> `activeEntity + 0xd48`

  The server had been sending `u32 0` as the first field in `sendEnterGameOk()`. That matches the live memory dump where `activeEntity + 0x5b0 == 0` even though the active-id global already held `0x3fd`.
  `sendEnterGameOk()` is now patched to send `this.entityType` in that first `u32` slot so the local player object gets a runtime id before combat starts.
- Private server dump clue:
  `/home/nikon/Downloads/shengxiao/Server/attrres/` contains:
  - `fight/fightPosition.txt`
  - `fightinfo.txt`
  - `skill/magic.txt`

  `fightPosition.txt` matches the side/row battlefield placement model already inferred from the client.
  `skill/magic.txt` is the same skill-definition domain the client loads for runtime action records.
  `fightinfo.txt` looks like a separate fight-command table and currently exposes at least command id `101`, which supports the idea that the top-level combat ring is driven by a different table than the skill ids used in `0x03f0`.
  The server now has a reference-data loader in `src/combat-reference.js` that reads those files directly and feeds local combat startup with reference-backed skill ids instead of the previous hardcoded `5001..5006` probe list.
- Private server binary (`gc_server.exe`) findings:
  - packet registration routine at `0x00412100` binds:
    - `0x03ed -> 0x00427630`
    - `0x03ee -> 0x00427690`
    - `0x03eb -> 0x00427440`
  - `0x00427630` is a thin wrapper that forwards `0x03ed` processing into `0x00463130`
  - the real `0x03ed` parser at `0x00463130` treats the first byte as a subcommand and then updates the current fighter object before advancing the fight list

- `0x03ed` subcommand shape from the original server:
  - `sub=0x03` and `sub=0x07`
    read three `u8` fields into the acting fighter at:
    - `+0x3e2`
    - `+0x3e3`
    - `+0x3e4`
    then call `0x00430380(fight_list)`
  - this exactly matches the live client attack-click packet:
    - `ed 03 03 01 01 02`
    - interpreted as `sub=0x03`, then three small action/target bytes `0x01 0x01 0x02`

- Fight resolution path:
  - `0x00430380` is not a packet sender itself; it validates the current node in `fight_list + 0x150` and then calls `0x0043ae30`
  - `0x0043ae30` is the fight-resolution state machine that consumes the fighter action mode stored at `fighter + 0x3e1`
  - when that mode resolves to attack-style case `0x03`, it uses the three bytes at `+0x3e2/+0x3e3/+0x3e4` as the action/target selection for combat resolution

- Default attack setup clue:
  the original server helper at `0x004316c0` seeds a normal attack by writing:
  - `fighter + 0x3e1 = 0x03`
  - `fighter + 0x3e2 = 0x01`
  - target position bytes into `fighter + 0x3e3` and `fighter + 0x3e4`
  This is strong confirmation that action mode `3` is the normal attack path in the original server.

- Local server follow-up:
  the local harness now treats inbound `0x03ed / 0x03` as a real synthetic attack selection:
  - parses the three client bytes after the subcommand
  - matches them against the current synthetic enemy formation row/col set
  - updates the targeted synthetic enemy HP
  - sends an experimental `0x03fa / 0x03` action-playback packet using the original-server one-target shape:
    - `u32 attacker_runtime_id`
    - `u32 target_runtime_id`
    - `u8 result_code`
    - `u32 damage`
  - then sends a minimal `0x03fa / 0x66` result/state update and matching `0x03fa / 0x67` mirror update before the follow-up `0x03f0`
  This is still only a minimal stand-in for the original server's full `0x00430380 -> 0x0043ae30` resolution path, but it moves the local reply into the same visible packet family the original server uses after attack resolution.
- Current encounter harness:
  the synthetic fight now spawns two enemies instead of one:
  - `Beetle A` at `(row=0, col=1)` with logical id `1`
  - `Beetle B` at `(row=0, col=3)` with logical id `2`
  The server resolves `atk` target bytes against whichever live enemy matches the selected board slot and only ends the fight after the whole group reaches `hp=0`.
  This layout now mirrors common two-monster formations in the private server scripts such as `scenefight/46.lua`, `scenefight/48.lua`, and `scenefight/42.lua`, all of which use the spread front-row pattern `(0,1)` and `(0,3)`.
- Reduced multi-enemy startup:
  for multi-enemy synthetic fights, the server now trims the startup probes to:
  - `0x03fa / 0x01`
  - `0x03fa / 0x34`
  and skips the extra `0x64 / 0x02 / 0x03 / 0x33` probes.
  The reason is pragmatic: the multi-target fight already enters, shows the wheel, and accepts attacks, so the remaining `Combat data error!` is more likely to be caused by extra state toggles than by the bare encounter rows.
- Turn-probe stability fix:
  the local harness no longer advances the persisted `0x03f0` probe index on every turn refresh inside the same fight.
  A synthetic encounter now selects one turn-profile at fight start and reuses it for:
  - the first readiness-handshake `0x03f0`
  - post-attack follow-up `0x03f0`
  This avoids sending contradictory command tables mid-fight, which was causing unstable behavior after the first attack.
- Handshake ordering fix:
  in the multi-enemy harness, the client can emit an attack selection before it has sent the first readiness `0x03ed / 0x09`.
  The server now suppresses the post-attack `0x03f0` refresh while that startup handshake is still pending, so one fight does not receive:
  - an `attack-selected` turn table
  - followed immediately by a second startup-style `client-03ed-09` turn table
  This was a local harness bug, not a protocol conclusion.
- Multi-enemy hit-path isolation:
  for a non-lethal hit in a synthetic fight with more than one live enemy, the server now skips:
  - `0x03fa / 0x66`
  - `0x03fa / 0x67`
  but still sends:
  - the verified `0x03fa / 0x03` playback packet
  - a follow-up `0x03f0`
  It also clears the pending startup handshake so a delayed `0x03ed / 0x09` cannot inject a late turn table after the player has already acted.
  This is an isolation patch to determine whether the current multi-target exit/error is caused by the post-hit sync packets rather than by the next-turn command table itself.
- Repeated readiness handling:
  after a non-lethal hit, the client can emit `0x03ed / 0x09` again as a fresh "ready for commands" signal.
  The local harness now treats that as a valid post-action command refresh trigger once the startup handshake has already been completed, instead of ignoring it.
  The refresh now re-sends:
  - `0x03fa / 0x01`
  - `0x03fa / 0x34`
  - `0x03f0`
  because the combat UI may need the ring-open packet as well as the control-show packet and turn table to re-enter command selection after a hit.
  The `0x34` show packet is now keyed explicitly to the synthetic player fighter's runtime id.
  Duplicate later `0x03ed / 0x09` packets are now suppressed by state, not timing: once the server has refreshed commands and is simply waiting for the player's next action, extra `0x09` packets are ignored.
- Synthetic fight state implementation:
  the local server now keeps a real per-encounter state object in `src/session.js` instead of only ad hoc enemy HP fields.
  It includes:
  - a player fighter record
  - enemy fighter records
  - current `hp/mp/rage`
  - `row/col/side`
  - `logicalId`
  - `round`
  - `phase` (`command`, `resolving`, `finished`)
  - `lastAction`
  - the selected persistent `0x03f0` turn profile
  Post-hit packets such as the current synthetic `0x66/0x67` mirror/update path now read player combat stats from that fight state rather than directly from top-level session fields.
  Enemy HP is maintained per fighter, not globally. The synthetic enemy array tracks each enemy's own `hp` and `alive` state.
- Synthetic enemy turn:
  for a non-lethal player hit in the current multi-enemy harness, the server now builds a round queue of live enemy turns instead of immediately trying to reopen commands.
  The queue is ordered by a synthetic initiative value and processed one actor at a time on successive client `0x03ed / 0x09` packets.
  While queued enemy turns remain, the harness now sends `0x03fa / 0x33` keyed to the next acting enemy's runtime id to keep the fight-control UI hidden between enemy actions.
  For each queued enemy turn it:
  - sends `0x03fa / 0x03` playback from enemy to player
  - sends `0x03f6 / 0x0a` self-state sync using the synthetic player's updated HP/MP/rage
  - decrements the player's HP in synthetic state
  Only after the queue is exhausted does it increment the round and re-send `0x03fa / 0x34` plus `0x03f0`.
  This is still synthetic logic, but it matches the expected "all enemy turns resolve before commands return" cadence better than the earlier single-retaliation shortcut.
- Multi-enemy kill correction:
  a lethal hit on one enemy in a multi-enemy fight should not use the old single-target death/result path.
  The local harness now keeps the fight alive and queues the remaining enemy turns whenever at least one enemy is still alive after the hit.
  Only when `livingEnemies.length === 0` does it mark the fight `finished` and emit the group-victory dialogue.
- Player death handling:
  the local harness now allows synthetic player HP to reach `0` during queued enemy turns.
  On player death it:
  - marks the synthetic fight `finished`
  - clears the remaining enemy-turn queue
  - ignores further inbound combat action/ready packets for that encounter
  - sends a minimal defeat dialogue
  This is a server-state completion step; it does not yet claim to reproduce the original client-facing defeat packet sequence.
  Current live logs still had the player surviving at `2 HP`, so this path had not actually been exercised yet in the observed runs.
- Isolation step:
  the harness is temporarily reduced from 3 enemies to 2 enemies to test whether the popup is tied to the third combatant row in the `0x03fa / 0x65` body.
  The local synthetic fight state also now carries the original server's stable logical target ids from `macro_AddFightMonster(..., logical_id)`, because the real server stores that fifth script argument in a per-fight map from logical id to runtime combatant id.

- Debugging correction:
  the local combat trace no longer treats outbound `0x03fa / 0x66` as an automatic fight-exit signal.
  That heuristic was too coarse and was obscuring post-attack testing, because the original server uses `0x66` in the live result/update path.

### Fight Command State Model
Confirmed from the fight-control helpers around `0x0051acd0..0x0051bb50`:

- `GetGameObject()->0x3bbc`
  Central client action-mode / command-selection field.
- `3bbc = 1`
  Strongest current candidate for "top-level combat ring active".
- `macro_ExecAction(menu_id)`
  Routes through `FUN_00456c90(menu_id)`, which dispatches top-level fight actions.
  Confirmed cases:
  - `1` sets `3bbc = 1` when in fight
  - `2` calls `FUN_0051b030(1)` when in fight
  - `9` sets `3bbc = 9` when in fight
  - `10` builds the summon submenu and opens `FIGHTCONTROL.summer`
  - `0xb` calls `FUN_0051bb50()`
- `FUN_0051b030`, `FUN_0051acd0`, `FUN_0051b2b0`, `FUN_0051b540`, `FUN_0051b660`, `FUN_0051b8d0`, `FUN_0051b990`
  These helpers stage concrete fight commands, target choice, or pet-side commands.
  Common pattern:
  - store pending command info in the fight manager
  - clear `3bbc`
  - call `FUN_00519a20()`
  - if `FUN_00519a20() == 0`, mark pending state and set `3bbc = 1`
  - otherwise optionally call `FUN_00517a60()` to emit the real `0x03ed` or `0x03f5` packet immediately
- Practical implication:
  the top-level ring seems to appear only after the client has entered one of these pending-command states.
  No currently confirmed incoming fight-stream packet has been shown to set that state directly.

### `FUN_00519a20` Role
Confirmed behavior:

- It validates whether the current active/targeted combatants and queue state are sufficient to continue without reopening command selection.
- It returns `0` in the "stay in selection/UI state" cases.
- It returns `1` only when the pending-selection bookkeeping has been exhausted and the queue entry can be popped.
- Practical implication:
  the current synthetic fight likely never reaches the same pending-command state the real client uses before showing the ring.

### `0x03fa / 0x69..0x6c` Classification
Confirmed from `DispatchFightStream03fa`:

- `0x69`
  Multi-field combat action/result packet between two looked-up entities. Not a startup/control initializer.
- `0x6a`
  Simple combat-tip popup path. Not a startup/control initializer.
- `0x6b`
  Perfect-kill / score / status text path.
- `0x6c`
  Structured pet/join-combat/status path with named values like `MyName`, `TarName`, and `Value`.

Practical implication:
- The `0x69..0x6c` cluster is result/status playback, not the missing action-wheel bootstrap.
- The low-numbered structured branches matter more for startup than another `0x03f0` id sweep.
- `side` is read before every combatant entry, not once per packet.
- Missing the `side` byte causes the parser to misalign and produces the in-client `Combat data error!` dialog.
- A zero-length `name` is rejected by the parser. The packet must send at least `\"\\0\"`, and in practice should send `\"Name\\0\"`.
- In the current synthetic server fight, using `side=0xff` for the active player and `side=1` for the enemy places them on the expected sides. The opposite assignment renders them swapped.
- `level_like` is surfaced by the client UI. Sending `0` shows `Level 0` on the battlefield labels.

### `0x03f0` Payload Shape
Confirmed from `HandleGamePacket03f0 -> FUN_00431a40 -> FUN_0054ce10`:

```text
u8 mode
if mode == 0:
  u16 count
  repeat count times:
    u16 field_a
    u16 field_b
    u16 field_c
```

Notes:
- The current server placeholder `0x03f0` packet is only structurally close, not semantically validated.
- A bogus `0x03f0` is a likely reason the client shows the order prompt but does not allow a real attack/action flow.
- Each `0x03f0` entry is passed into `FUN_0054cd70(field_a, field_b, field_c)`.
- `field_a` is the lookup key. The client resolves it through `FUN_00502500`, and the returned action-definition record selects the action class via `record + 0x0c -> FUN_0054d800`.
- `field_b` is passed into the created action object's virtual setup method together with the fight manager context. It is not the action-definition lookup id.
- `field_c` is stored into the action object as a `u16` through `FUN_0054afa0`, then mirrored into cached fields by `FUN_0054a660`.
- The action classes created by `FUN_0054d800` are keyed by `1, 2, 3, 5, 6, 8`.
- `FUN_0054cd20` deduplicates inserted actions by `record + 0x12`, which is likely the stable UI command id or slot id carried by the looked-up action-definition record.
- `field_b` behaves like a zero-based level/index into the looked-up record's per-level `0x26`-value table.
  Evidence:
  the common setup vmethod at `+0x2c` stores `field_b` as a byte and immediately fills cached values by calling `FUN_0054d190(field_b, stat_index)` for `stat_index=0..0x25`.
- The action-definition tree is populated during startup from `attrres\\Skill\\magic.txt`.
  `DAT_008ee7bc` is a tree container initialized by `FUN_0054de80`, then loaded by `FUN_0054dee0 -> FUN_0054db70`.
- `FUN_0054db70` inserts each loaded action record into that tree keyed by the parsed `u16` at record `+0x38`.
  `FUN_00502500(key)` searches this tree and returns the corresponding action-definition record.
- The built-in fight UI already proves that real action ids live in this tree.
  The `FIGHTCONTROL.skill` handler (`FUN_0047af60`) explicitly looks up ids `0x1389..0x138e` and adds them to the skill UI when the active entity supports them.
- Those built-in ids are:
  - `0x1389` = `5001`
  - `0x138a` = `5002`
  - `0x138b` = `5003`
  - `0x138c` = `5004`
  - `0x138d` = `5005`
  - `0x138e` = `5006`
- Practical implication:
  the earlier `100..107` probe range from `UI_DEF/config/751.cfg` is almost certainly UI/menu config, not the runtime `0x03f0.field_a` key space.
- Current server experiment:
  the server now probes `0x03f0` with multi-row profiles built from the client-recognized built-in action ids `5001..5006`.
  current profiles:
  - all six ids with `field_b=0`, `field_c=0`
  - all six ids with `field_b=1`, `field_c=0`
  - all six ids with `field_b=0`, `field_c=1`
  the next profile index is persisted in `combat-probe-state.json`, so a full server restart advances to the next profile.

### `0x03fa / 0x66` Payload Shape
Confirmed from `DispatchFightStream03fa` branch `0x00520f3e`:

```text
u32 state_a        // stored in DAT_008e90e8
u32 state_b        // stored in DAT_008e90ec
u32 state_c        // stored in DAT_008e90f0
u32 state_d        // stored in DAT_008e90f4
if state_d != -100000:
  u32 state_e      // stored in DAT_008e90f8
  u32 state_f      // stored in DAT_008e90fc

u32 field_1        // copied to fight manager + 0x2c08
u32 field_2        // copied to fight manager + 0x2c0c
u32 field_3        // copied to fight manager + 0x2c20
if field_3 > 0:
  u32 field_4      // copied to active target + 0x264
else if field_3 == -1:
  // snapshot current active target position back into DAT_008e90f4 / DAT_008e90f8

repeat until payload end:
  u32 list_value   // appended into a runtime list at fight manager + 0x2c28
```

Notes:
- `0x66` is not a standalone "leave fight now" packet.
- A minimal synthetic `u32 active_entity_id` body after the subcommand is far shorter than the real parser expects.
- The branch sets fight-manager state flags (`+0x29e6 = 1`, `+0x3cb4 = 1`) and updates the active target's cached coordinates/statelike fields if an active target exists.
- Because the client expects this larger structure, a 7-byte `0x03fa / 0x66` packet is parsed as incomplete/invalid state and does not exit combat.

### `0x03fa / 0x67` Payload Shape
Confirmed from `DispatchFightStream03fa` branch `0x005211c0`:

```text
u32 state_e8
u32 state_ec
u32 state_f0
u32 state_f4
if state_f4 != -100000:
  u32 state_f8
  u32 state_fc
```

Notes:
- `0x67` stores its values into the same `DAT_008e90e8/..ec/..f0/..f4/..f8/..fc` globals used by `0x66`.
- It sets fight-manager flags `+0x29e6 = 1` and `+0x3cb4 = 2`.
- Unlike `0x34` or `0x68`, it is not just a single-entity-id packet.
- Live result:
  sending a minimal structurally valid `0x67` immediately after `0x65` caused the synthetic encounter to terminate right away on the client.
- Practical implication:
  `0x67` is not a good combat-start companion for the current synthetic flow and should be left out of the startup probe sequence.

## Fight UI Config
- `UI_DEF/config/751.cfg` is binary, but its first dwords decode cleanly as:

```text
10,
100, 1,
101, 1,
102, 1,
103, 1,
104, 1,
105, 1,
106, 1,
107, 0,
204, 2500,
203, 2500
```

Notes:
- `100..107` are exposed by the client UI/config layer.
- Current RE indicates this range should not be treated as the direct runtime key space for `0x03f0.field_a`.
- The `0x03f0` lookup path instead resolves ids from the skill-action tree loaded out of `attrres\\Skill\\magic.txt`, with confirmed built-in fight ids already in the `5001..5006` range.

## Confirmed `0x03f1` Behavior
- `macro_ServerRunScript(a, b)` in Lua sends client->server `0x03f1`
- The client does not send destination map/x/y in travel requests
- `.b` map data does not encode destination either
- Server must map `(mapId, subtype, scriptId, and sometimes x/y)` to the destination

### `0x03f1 / sub=0x01`
- Used heavily for standing teleports and message/help actions
- Example:
  - Peach Garden standing teleporter: `0x03f1 / sub=0x01 / script=1 / map=209`

### `0x03f1 / sub=0x02`
- Used by higher-context scripted flows
- Apollo film exit is confirmed as:
  - `0x03f1 / sub=0x02 / mode=0xfe / contextId=12 / extra=0 / script=20001`
  - Bytes: `f1 03 02 fe 0c 00 00 21 4e`

## Confirmed `0x0407` Behavior
- `0x0407 / 'z'`
  Immediate local `script\\serverrun\\%d.lua`
- `0x0407 / '{'`
  Stores script id for later execution

Replying with `0x0407 / 'z' / 1000` is valid, but it only drives the generic onboarding/help branch. It does not reproduce the Apollo film/world transition.

## Synthetic Combat Harness Notes
- After a valid player-command refresh, the client often emits one more bare `0x03ed / 0x09`.
- In the local combat harness that packet must be suppressed explicitly; otherwise the server re-sends `0x03fa / 0x01`, `0x03fa / 0x34`, and `0x03f0`, which makes the wheel reopen redundantly.
- The harness now tracks this with `syntheticFight.suppressNextReadyRepeat`, set on command refresh and cleared once a player or enemy action actually begins resolving.
- The current `Combat data error!` investigation is focused on `0x03f0`, not `0x03fa / 0x65`.
  The harness now sends a single-row minimal turn table built from the first reference action id instead of a six-row reference-skill batch, to test whether the popup is caused by extra invalid action rows.
