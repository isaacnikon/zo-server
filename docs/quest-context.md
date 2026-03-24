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

## Notes

### Current modeling rules that proved important
- Some quest interactions arrive through `GAME_SERVER_RUN_CMD` instead of the older quest packet.
- For several NPC talk flows, the packet carries a map-local NPC index rather than the final NPC id.
- Kill-step completion and objective progress are distinct client concepts and must not share one field.
- Client reward UI does not imply a second reward packet; some reward selection data is embedded in the completion interaction itself.
- Client-derived quest state in `data/client-derived/task-state-clusters.lua` has been the most reliable source for correcting bad server quest data.
