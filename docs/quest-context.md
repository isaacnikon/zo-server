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

## Notes

### Current modeling rules that proved important
- Some quest interactions arrive through `GAME_SERVER_RUN_CMD` instead of the older quest packet.
- For several NPC talk flows, the packet carries a map-local NPC index rather than the final NPC id.
- Kill-step completion and objective progress are distinct client concepts and must not share one field.
- Client reward UI does not imply a second reward packet; some reward selection data is embedded in the completion interaction itself.
- Client-derived quest state in `data/client-derived/task-state-clusters.lua` has been the most reliable source for correcting bad server quest data.
