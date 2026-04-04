# Quest Context

This file tracks quest-system issues that were discovered while bringing live quest flows up to parity with the client. Each entry records the observed failure, root cause, and the fix that was applied.

## Runtime / Protocol Fixes

### Quest accept from NPC did nothing
- Issue: NPC talk packets reached the server, but some quests could never be accepted.
- Root cause: normalized quest definitions dropped `acceptNpcId` and `acceptSubtype`, so NPC acceptance matching always failed.
- Resolution: preserved accept metadata during quest normalization in `src/quest-engine/`.

### Quest turn-in via `server-run sub=0x08` did nothing
- Issue: some NPC hand-ins used `GAME_SERVER_RUN_CMD` `sub=0x08` instead of the older quest-talk path and were ignored.
- Root cause: NPC interaction handling only supported a narrower packet set.
- Resolution: routed `sub=0x08` through the quest NPC interaction flow in `src/handlers/npc-interaction-handler.ts`.

### `sub=0x08` used map NPC index, not proximity
- Issue: turn-ins were initially recovered with proximity heuristics, which was unstable and incorrect.
- Root cause: the packet's leading argument was the map-local NPC index, not an arbitrary talk location.
- Resolution: removed proximity fallback and resolved NPCs deterministically from the packet in `src/handlers/npc-interaction-handler.ts`.

### Quest completion via `server-run sub=0x04` was ignored
- Issue: some final hand-ins talked to the right NPC but never completed the quest.
- Root cause: `GAME_SERVER_RUN_CMD` `sub=0x04` was not parsed into the same NPC/script interaction path as other quest talks.
- Resolution: parsed the packet shape in `src/protocol/inbound-packets.ts` and routed it through `src/handlers/npc-interaction-handler.ts`.

### Quest abort did not remove granted quest items
- Issue: abandoning a quest left temporary quest items in the bag.
- Root cause: the client aborted via `GAME_SERVER_RUN_CMD sub=0x05`, but only the old `0x03ff sub=0x05` quest path handled abandonment.
- Resolution: unified abandon handling in `src/handlers/quest-handler.ts` and dispatched `server-run sub=0x05` from `src/handlers/packet-dispatcher.ts`.

### Quest resets from save files did not show in UI
- Issue: after manually resetting quests in save data, the quest did not appear after relog.
- Root cause: saved quest records used `taskId`, but quest normalization only accepted `id`.
- Resolution: `src/quest-engine/` now accepts both `id` and `taskId` when restoring active quests.

### Quest progress UI stayed at `0/1` after a kill
- Issue: kill quests advanced internally but the client still showed `0/1`.
- Root cause: the server's progress packets mixed step status and kill counter semantics, and used the wrong objective identifier for kill progress.
- Resolution:
- split quest step status from objective progress count in `src/quest-engine/`, `src/objectives/quest-event-handler.ts`, `src/handlers/quest-handler.ts`, and `src/types.ts`
- restored the expected update/marker packet sequence
- used the monster id as the objective id for `0x03ff sub=0x0b`

### Reward selection was ignored on quest completion
- Issue: the client reward choice UI appeared, but the server always granted the first reward.
- Root cause: reward selection was carried in the `server-run sub=0x04` hand-in packet and was not extracted.
- Resolution:
- added `awardId` parsing to `src/protocol/inbound-packets.ts`
- threaded `selectedAwardId` through `src/types.ts`, `src/handlers/npc-interaction-handler.ts`, `src/objectives/objective-dispatcher.ts`, and `src/objectives/quest-event-handler.ts`
- updated `src/gameplay/reward-runtime.ts` to honor the selected reward instead of defaulting to option 1

### Fresh `quest2` talk accepts could visually skip the first step
- Issue: after accepting `Back to Earth` from Apollo, the client could render the quest as if the Blacksmith step was already cleared even though the server still had `stepId = "meet_blacksmith"`.
- Root cause: runtime quest sync for `quest2` always replayed both full-state packets (`0x03ff sub=0x03` and `sub=0x08`); for a fresh talk quest, that extra full update-state packet was enough for the client to locally treat the current talk step as already updated.
- Resolution:
- `src/handlers/quest-handler.ts` now sends the full `quest2` update-state packet only when the quest is a kill step, has already advanced beyond the first step, or carries a non-zero status
- fresh talk-step accepts still receive accept-state, table sync, markers, and history, but no immediate full update-state replay

## Quest Data Corrections

### Quest `3` capture hand-in rejected valid flask state
- Issue: the quest UI showed the capture objective complete, but talking to Grocer returned `item-missing`.
- Root cause:
- the server quest model lost capture-specific consume metadata
- the matcher was too strict about the flask template
- stale consume items from the original server quest JSON were still present
- Resolution:
- recovered capture requirements from client-verified quest data in `src/quest-engine/`
- matched capture hand-ins by captured monster id plus Mob Flask family item in `src/handlers/npc-interaction-handler.ts`
- replaced stale consume lists for capture steps in `src/quest-engine/`

### Quest `4` `Evilelf` fight completed immediately on kill
- Issue: killing `Evilelf` removed the quest instead of requiring the return talk shown by the client.
- Root cause: quest `4` lacked return-after-kill metadata.
- Resolution: updated `data/quests/main-story.json` so the kill step now has:
- `completeOnTalkAfterKill: true`
- `completionNpcId: 3006`
- `completionMapId: 102`
- a return-to-`Evilelf` completion description

### Quest `1` `Back to Earth` used the wrong blacksmith identity in Rainbow Valley
- Issue: the Rainbow Valley blacksmith could render or resolve as the Cloud City blacksmith alias, which broke the intended quest interaction path.
- Root cause: map bootstrap spawn generation and NPC interaction resolution both preferred `resolvedSpawnEntityType` for alias-mismatch NPCs, while the quest data and client help data for `Back to Earth` are keyed to Rainbow Valley map NPC `3276`.
- Resolution:
- `src/map-data.ts` now spawns `validationStatus === "alias-id-mismatch"` NPCs with their map-local `npcId` instead of the alias entity type
- `src/handlers/npc-interaction-handler.ts` now applies the same rule when resolving an NPC click, so Rainbow Valley blacksmith stays on `3276` end-to-end

### Quest `1` `Back to Earth` auto-progressed incorrectly from item possession
- Issue: once the blacksmith identity was fixed, the quest could still advance too easily because the server treated step 2 as a normal talk hand-in gated only by having `Timber` (`21116`) in the bag.
- Root cause: the server quest record only stored generic step/progress state and did not model the client-side intermediate requirement that the player must talk to Matt before Blacksmith accepts the second step.
- Resolution:
- `data/quests/main-story.json` now marks Matt's `grant_on_server_run` action with `setProgressFlag: "mattTalked"`
- quest `1` step 2 now requires `requiredProgressFlag: "mattTalked"` in addition to the timber item
- `src/quest-engine/data.ts` now preserves quest `auxiliaryActions` and `requiredProgressFlag`
- `src/quest-engine/state.ts` now blocks talk-step advancement until the required progress flag is present
- `src/handlers/npc-interaction-handler.ts` now applies quest auxiliary `grant_on_server_run` actions at runtime, including persisting flag-only progress updates

### Quest `1` `Back to Earth` still appeared to auto-progress on relog
- Observation: persisted quest state for the live save stayed clean (`stepIndex: 0`, `status: 0`, empty `progress`), so the relog behavior was not explained by saved quest progress or a persisted Matt flag.
- Current likely root cause: the login quest sync path replayed both full accept-state and full update-state packets for active talk quests, which appears to give the client enough state to locally treat the talk step as already updated.
- Resolution:
- `src/handlers/quest-handler.ts` now sends the login-time full `0x03ff sub=0x08` update-state packet only for kill quests, not active talk quests
- active talk quests still receive login accept-state, markers, history, and normal quest-table sync
- Follow-up: if quest `1` still auto-progresses after relog, add a targeted trace for task `1` during login sync to identify which outbound packet changes the client-local state

### Quest `1` `Back to Earth` migrated cleanly into `quest2`
- Goal: remove the legacy auxiliary quest path while keeping Matt's Timber grant and `mattTalked` flag requirement.
- Root cause: the original `quest2` model only supported the current step's primary trigger and completion effects, which was not enough to express “talk to Matt during the active Blacksmith step, grant Timber, set a flag, but do not advance the visible step yet.”
- Resolution:
- `src/quest2/schema.ts` now supports step `reactions`, step `eventEffects`, quantity-based progress, idempotent quest item grants, and capture-aware turn-in requirements/effects
- `data/quests-v2/definitions.json` now models quest `1` with:
- accept from Apollo (`3054`) granting the recommendation token
- `meet_blacksmith` as the first real step
- `bring_timber` as the second step
- Matt (`3029`) as a reaction on `bring_timber` that sets `mattTalked` and grants Timber idempotently
- Blacksmith (`3276`) still requires both the Timber item and `mattTalked` before completion
- structured `quest2` storage/import was extended in `db/migrations/V14__extend_quest2_schema_for_reactions_and_capture.sql` and `apps/game-server/scripts/import-quest2-json-to-db.ts`

### Quest `51` `Pet` skipped Scholar's item swap
- Issue: talking to Scholar advanced the quest toward Idler, but `Candy's Recommendation` (`21123`) stayed in the bag and `Scholar's Letter` (`21001`) was never granted.
- Runtime evidence:
- fresh trigger trace showed the Scholar click arriving as `server-run sub=0x08 rawArgs=[4,101,51] scriptId=51` on map `101`
- current save state for `NeoE5F0` showed quest `51` already at `stepIndex: 1`, `status: 2`, while inventory still contained `21123` and not `21001`
- Root cause:
- the `sub=0x08` parser previously left `scriptId` unset, which could block auxiliary quest action matching
- more importantly, `src/handlers/npc-interaction-handler.ts` only applied quest `auxiliaryActions` when normal `interactWithNpc(...)` returned no events
- Scholar's click produces a normal talk-step advancement event, so the auxiliary `consume 21123 / grant 21001` action for quest `51` was skipped entirely
- Resolution:
- `src/protocol/inbound-packets.ts` now parses `scriptId` for `GAME_SERVER_RUN_CMD sub=0x08`
- `src/handlers/npc-interaction-handler.ts` now converts auxiliary `consumeItems` into quest inventory events
- `src/handlers/npc-interaction-handler.ts` now merges auxiliary quest events with normal NPC quest events on the same click instead of treating them as mutually exclusive
- Operational note: if a character save already advanced past Scholar before the fix, the side-effect will not replay automatically; reset quest `51` to step `1` or retest on a fresh character path

### Quest `51` `Pet` could not enter Little Boar combat
- Issue: after reaching the `Kill "Little Boar"` step on map `103`, clicking Little Boar (`3007`, script `10001`) only replayed the NPC script and never opened combat.
- Runtime evidence:
- the live log showed `NPC interaction sub=0x2 resolvedNpcId=3007 ... scriptId=10001 map=103` followed immediately by `Sending script-event immediate ... script=10001`
- the active quest state at login was already `stepIndex=3`, `status=4`, which is the Little Boar kill step for quest `51`
- Root cause:
- quest `51` models the fight as an auxiliary `combat_on_server_run` action rather than a plain kill-step NPC match
- `src/handlers/npc-interaction-handler.ts` did not support `combat_on_server_run`, so the click fell through to ordinary script replay
- `src/quest-engine/data.ts` also normalized auxiliary actions without preserving `monsterId` and `count`, which meant the combat trigger payload was lost even after adding runtime support
- Resolution:
- `src/handlers/npc-interaction-handler.ts` now recognizes quest auxiliary `combat_on_server_run` actions and starts the configured encounter when the NPC/script/map match
- `src/quest-engine/data.ts` now preserves `monsterId` and `count` on normalized auxiliary actions so NPC-triggered quest combat retains its encounter definition
- Scope check:
- current quest data contains exactly one `combat_on_server_run` action, the Little Boar fight in quest `51`, so the runtime change does not broaden behavior for unrelated quests

### Quest `353` `Behind the Curtain` had wrong step flow
- Issue: step progression did not match the client quest UI and Piggy fight trigger was wrong.
- Root cause:
- step 1 was keyed to the wrong NPC after acceptance
- the final kill step was initially modeled as a field kill instead of an NPC-triggered fight
- Resolution: updated `data/quests/main-story.json` so quest `353` now does:
- accept from Scholar (`3004`)
- talk to Grandpa (`3023`)
- talk to Piggy fight trigger NPC (`3108`) on map `102`
- kill `Piggy` (`5006`)
- return to Grandpa with `completeOnTalkAfterKill: true`

### Quest `353` reward set was wrong
- Issue: Grandpa completion only granted coins/exp, but the client showed a build-dependent three-book reward choice.
- Root cause: quest reward data and runtime reward selection did not reflect aptitude/build-specific rewards.
- Resolution:
- corrected quest `353` reward table in `data/quests/main-story.json`
- implemented build-specific reward resolution for all aptitude types in `src/gameplay/reward-runtime.ts`

### Quest `354` `Passing the Love` granted the wrong item
- Issue: accepting the quest gave `Sachet`, but the client expected `Fennel`.
- Root cause: accept grant and step item grant/consume data were reversed.
- Resolution: updated `data/quests/main-story.json` so quest `354` now:
- grants `Fennel` (`21051`) on accept
- consumes `Fennel` at Maria (`3028`)
- grants `Sachet` (`21002`) for the Hubbert hand-in

### Quest `354` advanced into a bogus third step instead of completing
- Issue: after talking to Hubbert with `Sachet`, the quest stayed active in a dead step.
- Root cause: server quest data had an extra third step not present in client-derived task state.
- Resolution: removed the fake third step from `data/quests/main-story.json`; quest `354` should complete on the Hubbert talk.

### Quest `355` `Hungry Wolves` completed too early
- Issue: talking to Farmer immediately completed the quest.
- Root cause: quest `355` was modeled as a one-step talk quest instead of a kill-then-turn-in quest.
- Resolution: updated `data/quests/main-story.json` so quest `355` now:
- starts from Grandpa (`3023`)
- uses NPC-triggered combat from `Hungry Wolf` (`3057`) on map `102`
- kills `Hungry Wolf` monster `5005`
- returns to Farmer (`3003`) with `completeOnTalkAfterKill: true`

### Quest `356` `The Lost Child` current findings
- Observation: the quest is active in save data, the quest UI points to Gladys (`3070`) in Cloud City, and the server now sends the richer client-style quest state for this task.
- Current quest data: `data/quests/main-story.json` still models this as a single talk step to Gladys (`3070`) on map `112` with description `Take "Eric" home`.
- Supporting client map data:
- Eric is NPC `3055` in Bling Alley (`102`)
- Gladys is NPC `3070` in Cloud City (`112`)
- Current runtime evidence:
- after moving to Gladys, the server still receives no NPC interaction packet for the turn-in attempt
- there is still no `quest complete ... taskId=356`
- fresh accepts initially sent only `0x03ff sub=0x03` plus marker, which left the in-session accept flow incomplete even though login sync was richer
- UI confirmation:
- the client quest panel explicitly says `Escort Eric back to his mother Gladys (Cloud City 11,384)`
- the screenshot shows the player standing on Gladys with the correct quest selected
- clicking Gladys still produces no server-visible turn-in packet
- Authoritative Ghidra findings from `gc12.exe`:
- `0x03ff sub=0x03` and `sub=0x08` both feed the same full quest-state parser
- after `taskId`, the client expects `currentStep`, `taskType`, `maxStep`, `overNpc`, `taskRole`, then 10 objective words
- `macro_SetOverNpc(...)` writes quest-slot `+0x16`
- `macro_SetTaskType(...)` writes quest-slot `+0x18`
- `macro_SetTaskRole(...)` writes quest-slot `+0x1c`
- for `taskType` bit `0x08`, quest completion checks compare the selected entity type against quest-slot `+0x1c`
- `macro_AddTaskCre(...)` is a no-op stub in the client
- quest `356` therefore expects:
- `taskType = 8`
- `overNpc = 3070` (`Gladys`)
- `taskRole = 3055` (`Eric`)
- authoritative client-network finding:
- the client rebuilds active quest slots through packet `0x07d2`, subtype `0x08`
- for normal quests `< 801`, that path copies the quest record from the client task table and runs `script\\task\\updo\\<taskId>_<step>.lua`
- Server-side fixes applied so far:
- `src/handlers/npc-interaction-handler.ts` now routes ordinary `subcmd 0x02` NPC talks through quest interaction handling
- `src/handlers/quest-handler.ts` now sends `0x07d2 sub=0x08` on login sync
- `src/handlers/quest-handler.ts` now sends full-state `0x03ff sub=0x03` and `0x03ff sub=0x08` packets with `overNpc=3070` and `taskRole=3055`
- `src/handlers/session-bootstrap-handler.ts` currently reintroduces the `taskRole` NPC spawn for active `taskType 8` quests on the current map as a parity experiment
- Current follow-up:
- `src/objectives/quest-event-handler.ts` now sends a positive `0x03ff sub=0x08` immediately after quest accept so fresh accepts use the same richer state path as login sync
- `src/handlers/quest-handler.ts` now sends `0x07d2 sub=0x08` on runtime quest sync too, not just login
- `src/objectives/quest-event-handler.ts` now triggers a runtime quest-table rebuild on accept before the direct `0x03ff` accept/update packets
- `src/quest-engine/data.ts` and `src/handlers/quest-handler.ts` now preserve client-derived cluster metadata for `maxAward` / `taskStep` and send those as the two `u16` extras in `0x07d2 sub=0x08` instead of zeroes
- `src/quest-engine/state.ts` now includes the client-facing type-8 fields directly in the built quest sync object (`clientTaskType`, `overNpcId`, `taskRoleNpcId`, `maxAward`, `taskStep`) so the live quest object reflects the client-required state instead of recomputing it in only one packet path
- Ghidra client finding: the type-8 completion check reads a live object pointer from `GetLocalPlayerEntity()+0xce8`, and `ShowQuestNpcTracker` constructs that object from the task Lua macro path; broad scene/state reset code also clears it
- Server follow-up: `src/handlers/packet-dispatcher.ts` now replays runtime quest sync on map transitions / pending scene spawn completion so active type-8 quest state is rebuilt after scene changes, not only on login or accept
- Server follow-up: `src/handlers/session-bootstrap-handler.ts` now sends the login quest sync after the map NPC spawn batch instead of before it, so active type-8 quest reconstruction runs against the final scene bootstrap state after relog
- Server follow-up: `src/handlers/quest-handler.ts` now replays `0x0407` immediate and deferred script events for active `taskType 8` quests during quest-state sync, targeting the remaining difference between relog-time `updo` reconstruction and the original `doing` script path that contains `macro_AddTaskCre(3055)`
- Corrected Ghidra interpretation: `0x03ff sub=0x0c` itself creates the local quest tracker by calling `ShowQuestNpcTracker(GetLocalPlayerEntity(), trackedNpcId, extra)`, and that tracker is creature-like, not quest-like:
- tracker field `+0x40` drives `script\\creature\\<id>\\...`, so it must be the tracked NPC template id
- type-8 completion compares the live tracker’s `+0x40` value against quest-slot `+0x1c`, which brings the packet-driven path back in line with the offline script value `3055` (`Eric`)
- tracker field `+0x5b0` is later fed into `LocalPlayer_SendServerRunRequest(...)` from Lua, so the `u32 extra` in `0x03ff sub=0x0c` appears to be a live runtime/entity id rather than a plain template id
- Server follow-up: `src/handlers/quest-handler.ts` now restores `taskRole=3055` in full-state `0x03ff` packets for `taskType 8`, and `0x03ff sub=0x0c` now sends the tracked NPC template id plus the current map runtime id for that NPC when it can be resolved
- Next verification point:
- after relog with quest `356` still active, logs should show:
- `Sending quest accept cmd=0x3ff sub=0x03 taskId=356 ... overNpc=3070 targetNpc=3055`
- `Sending quest update cmd=0x3ff sub=0x08 taskId=356 ... overNpc=3070 targetNpc=3055`
- `Sending quest marker cmd=0x3ff sub=0x0c questId=356 trackedNpc=3055 trackedRuntime=... markerNpc=3070`

### Stale quest UI persisted across account switch / relog
- Issue: after switching accounts or relogging, the quest window could still show old quest rows from the previous session even when the current server login only sent a much smaller active/completed set.
- Runtime evidence:
- `server.log` showed correct per-account quest sync with distinct runtime ids and only the expected active/history payload for each account
- the visible stale rows exceeded what the current account save contained, proving the extra rows were client-retained UI state
- `RefreshTaskListWindow` at `0x556ce0` is the function that renders the quest window, and it reads quest data from local player quest memory plus the quest window cache
- Authoritative client findings:
- the quest window cache object is global `DAT_006436ec`; `FUN_00440a90` / `FUN_0043ffa0` clear it
- the global teardown path `FUN_00414980` / `FUN_00414a8e` does clear `DAT_006436ec`, but the relog/account-switch path being exercised does not reach that teardown
- the active quest rebuild handler is `FUN_00504460` (`0x07d2`) and it calls `FUN_0044f7b0`
- the completed/history quest handler is `HandleQuestPacket_03FF` (`0x03ff`) and it routes through `0x504c90` / `0x502670`
- live debugger repro showed that on relog none of these fired:
- `0x504460` (`0x07d2` dispatcher)
- `0x504c90` (`0x03ff` wrapper)
- `0x504cd0` (`0x03ff` core)
- `0x44f7b0` (quest-table rebuild)
- `0x44cd00` / `FUN_0044cbf0` (player quest-state reset)
- Root cause:
- the stale quest rows are not primarily caused by the quest window list widget itself
- the relog path being used by the live client is bypassing the client quest packet dispatch/rebuild path entirely; `0x07d2` and `0x03ff` are only registered in a secondary packet table, but the relog path dispatches from the main table
- Previous failed patch attempts:
- forcing quest-window cache clear from the `0x44f7b7` rebuild hook did not help because the relog path never entered that hook
- mirroring quest handlers into both packet tables at startup was attempted as a blind startup-registration patch, but it crashed the client on launch and was fully reverted; `gc12.exe` was restored to stock after those experiments
- Resolution: `scripts/patch/patch-client-quest-ui-reset.py` applies the following changes to `gc12.exe`:
- `quest-table-runtime-gate` (`0x5044E7`): NOPs the `JNZ` that blocked `0x07d2 sub=0x08` table rebuild when runtimeIds differ — unblocks the relog case where runtime ids are reset
- `quest-history-reset` (`0x44CD5C`): retargets quest-history clear from `FUN_00449d50` to `FUN_00449d90`
- `quest-full-reset-on-table-rebuild` (`0x44F7B7`): retargets the call inside the rebuild path to a new wrapper (stage 1–3, written into `0xCC` caves at `0x4013A1`, `0x401732`, `0x401755`) that runs the full quest reset and then clears the UI cache object (`DAT_006436ec`)
- `quest-dual-stream-registration-hook` (`0x514EDA`): redirects the last secondary-table registration call through a stub (stages 1–5, at `0x403191`–`0x403401`) that registers `0x07d2` in the main packet table and `0x03ff` in the secondary table; this uses the original call's existing stack arguments so there is no blind startup crash

## Notes

### Current modeling rules that proved important
- Some quest interactions arrive through `GAME_SERVER_RUN_CMD` instead of the older quest packet.
- For several NPC talk flows, the packet carries a map-local NPC index rather than the final NPC id.
- Kill-step completion and objective progress are distinct client concepts and must not share one field.
- Client reward UI does not imply a second reward packet; some reward selection data is embedded in the completion interaction itself.
- Client-derived quest state in `data/client-derived/task-state-clusters.lua` has been the most reliable source for correcting bad server quest data.
## Bonnie Quest Chain

- `Soul of Bonnie` is NPC `3036`; `Franklin` is NPC `3118`.
- Quest `7` (`Disenchanting`) is still active in `data/save/characters/NeoE5F/active-quests.json`.
- Quest `8` (`Magical Adventure`) cannot be accepted yet because its prerequisite is quest `7`, and its actual `acceptNpcId` is `3118` (`Franklin`), not `3036` (`Soul of Bonnie`).
- Current save state shows quest `7` active but quest `7` is not in completed quests, so the Bonnie click is not a valid accept path for `8`.
- Server logs confirm the Bonnie click reaches the server on `0x03f1 sub=0x08`, but no accept event follows because there is no quest accept available from `3036` in the current state.
- Root bug in our quest data: quest `7` was flattened into a single Franklin turn-in step and granted `Bonnie's Pendant` on accept.
- Active quest flow for `7` should be:
  1. accept from `3030` (`Hubbert`)
  2. talk to `3118` (`Franklin`)
  3. talk to `3036` (`Soul of Bonnie`) to receive `Bonnie's Pendant`
  4. return to `3118` (`Franklin`) to complete
- `data/quests/main-story.json` has been restored to that Franklin -> Bonnie -> Franklin progression.
- Remaining runtime issue: Franklin's first-step click is not consistently reaching the server quest handler, so the quest can still appear stuck even with the corrected step order.
- Additional runtime bug found: accepted quests were emitting the runtime sync and then a second direct `accept/update/marker` sequence from `quest-event-handler.ts`.
- This produced duplicate `0x03ff sub=0x03` accept packets in logs for quest `7`, which is a likely source of the client showing the wrong active step.
- The duplicate post-sync accept/update send was removed; accepted quests now rely on the runtime sync path only.
