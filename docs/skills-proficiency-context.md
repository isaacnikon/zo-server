# Skill And Proficiency Context

## Current State

The server skill system has been generalized around repo-owned metadata instead of client archive files at runtime.

See also:

- `docs/skill-exploration-playbook.md`

Core files:

- `data/skills.json`
- `src/gameplay/skill-definitions.ts`
- `src/gameplay/skill-runtime.ts`
- `src/combat/skill-resolution.ts`
- `src/combat/combat-formulas.ts`

## Skill Model

The server now treats skills as a three-variant family:

- active skill: `skillId`
- passive counterpart: `10000 + skillId`
- aptitude counterpart: `20000 + skillId`

Rules currently implemented:

- passive effective level is `floor(active level / 2)`
- passive max level is `5`
- aptitude variant extends active progression beyond the base cap
- active skills remain the hotbar/runtime-facing ids

## Metadata Source

`data/skills.json` is now the server-owned source of truth for:

- skill id and name
- template id where applicable
- acquisition source
- learn requirements
- incompatible skills
- implementation class
- behavior
- selection mode
- follow-up mode
- counterattack eligibility
- mana costs by level
- proficiency thresholds by level
- description text

The JSON was populated from client-derived sources as a first pass, but runtime code no longer depends on client files.

## Combat Dispatch

Skill execution is routed by implementation class `1..16`, with behavior hints used as shared fallback logic.

Generalized stages in the runtime:

- skill selection
- cast/event packet
- class-13 follow-up handling
- optional counterattack/counter-response gating
- completion/end packet flow

The dispatch shape is generalized, but exact per-class formulas and status semantics are not fully reverse-engineered yet.

## Client-Validated Targeting

Recent Ghidra validation in `gc12.exe` confirms that outbound combat skill queuing is target-first, not self-only:

- `QueueCombatSkillCommand @ 0x51b660`
- parameters resolve as `targetEntityId`, then `skillId`
- the helper it calls (`FindCombatEntitySlotByRuntimeId @ 0x515cf0`) looks up a live combat entity slot by runtime/entity id before the command is accepted

Practical implication:

- client-selected ally heals cannot be inferred from static `selectionMode` metadata alone
- `Cure (4103)` is queued by the client with an explicit ally entity id
- server combat resolution must honor that ally target instead of collapsing the skill back to the caster

Current repo note:

- `data/skills.json` still has some first-pass targeting hints that came from imported metadata
- for `Cure`, the live client behavior is the authoritative source, not the current `"selectionMode": "self"` placeholder in JSON
- a live breakpoint on the real `0x03fa sub=0x04` handler confirmed Cure reaches the client HP-increase branch at `0x52090a`
- so the remaining red-number playback mismatch is downstream of target selection and server HP application; Cure is already classified as a heal by the client result path
- live runtime traces showed that emitting Cure with support-style `actionCode=0` on ally targets makes the client play a dodge-like result
- Cure therefore stays on `actionCode=1` for ally-target result playback, while the heal value remains the raw caster-side heal amount
- Cure now preserves the raw heal value from the caster formula and clamps only the target HP write to max HP; overheal reduces actual HP gain but does not shrink the underlying skill heal value
- fresh April 8 runtime traces still showed Cure casts as `0x03fa sub=0x04` with `actionCode=1` and a raw heal payload, and the client still rendered red floating numbers
- the extracted client magic tables also expose a parallel single-target Restoration row at `24103` alongside learnable `4103`, but live client state only exposed `4103` in learned/hotbar data and `14103` as the passive aptitude counterpart
- that means the earlier `24103` outbound packet-id override for normal Cure was not client-confirmed; `24103` aligns better with the 20k aptitude-active skill-id family than with a generic playback alias
- objdumping the live client around `0x520eb5` showed the parsed `sub=0x04` result dword is written directly into the queued playback event amount field at `event+0x40`
- the later playback-state builder reads that same field as `param_1[0x10]`: negative values take the explicit `recovered HP` path, while positive values take the attack popup path
- that makes Cure's remaining red-number bug a direct packet-value sign mismatch on the wire, not a hidden second-stage prelude requirement
- the client `0x03fa sub=0x04` parser also decodes `targetValue >= 100000000` as a heal-style encoded result: it subtracts `100000000`, keeps the visible value, and stores a hidden per-target flag for the later playback-state builder
- a live server experiment disproved the naive packet-side use of that marker for Cure: sending `100000000 + healAmount` caused a broken oversized heal result on the client instead of a clean green popup
- newer client-side tracing narrowed the `0x03fa sub=0x04` target action-byte handling further: explicit action cases confirmed in the real parser are `0`, `3`, and `0x0e`, while `1` still falls through the generic nonzero path that can reach Cure's HP-increase branch at `0x52090a`
- there is still no client evidence that `4` or `5` are dedicated heal result codes for Cure in this handler
- fresh April 9 live breakpoints on the real Cure casts confirmed the signed heal value is now correct all the way through the actual client heal branch: the Cure path reached `0x52090a` with `EAX = -195` and the same negative dword on the stack
- that means the remaining red popup is no longer a wire-sign problem; the bad `24103` packet-id override, `actionCode=0`, and `100000000 + healAmount` experiments should not be repeated without new client evidence
- the first popup call immediately after that same real Cure branch came from `0x43763d -> FUN_00436060`, still with popup style argument `1` and amount `-195`
- static analysis of the caller at `0x00437400` shows its queued-effect cases `1`, `3`, and `0x11` always invoke `FUN_00436060(..., 1, 2, amount, 0xb, scale)`, while its recovery-style cases `8` and `0xd` use the non-offensive popup style instead
- the remaining unresolved question for Cure is therefore the client row/result-category linkage that makes Restoration land in queued-effect case `1` instead of the heal-styled case, not the packet sign itself
- newer client table comparison tightened the row-selection side: `4103.TXt` uses the `58/56` pair, while `24103.TXt`, `24201.TXt`, and `30103.TXt` share the `59/57` pair associated with the stronger heal/regeneration family
- that makes a fresh `24103 + negative targetValue` retry evidence-based rather than a repeat of the earlier disproved positive-value `24103` probe
- the April 9 live breakpoint on `ProcessQueuedCombatEffectResult @ 0x00437400` during that retry resolved the queued record as row `0x5e27` (`24103`), variant `1`, result case `1`, amount `-195`
- that proves the `24103` row override alone does not change Cure into a heal-style popup path; the client still lands in offensive case `1`
- the next client-consistent corrective direction is therefore `actionCode=8` with a positive raw heal amount for Cure, because cases `8` and `0xd` are the recovery-style branches and they consume positive amounts rather than the negative case-1 convention
- sampled live outbound skill packets on the current server still only use action codes `0`, `1`, and `3`
- rechecking the client `0x03fa sub=0x06` round-control parser confirmed that packet carries round/selector control state, not any per-skill id; current server output is still the simple `round + selectorToken + 0 + 0x0c` form
- that means a malformed `sub=0x06` can still poison later Cure playback indirectly through selector state, but `sub=0x06` itself is not a demonstrated Cure-specific prelude carrier
- those same April 8 fights still did not log any fresh client selector-token input (`0x03ed sub=0x0a` / `0x03f5 sub=0x51,0x56,0x58`), so selector-state flow in the client `sub=0x06` -> `sub=0x04` path remained the next open issue after the failed `24103` override experiment
- the strongest concrete mismatch in that selector flow was duplicated shared-team `sub=0x06` round-start output: on `2026-04-08T18:56:52.729Z` and `2026-04-08T18:56:52.789Z`, follower session `2` received two round-start packets for round 1 with different server-generated selector tokens
- that duplicate prompt came from the follower consuming its own intro ready packet before the shared-combat owner transitioned the whole team into command phase
- the server now consumes follower intro-ready packets and leaves shared-team `sub=0x06` emission to the owner only

## Proficiency Progression

Progression is proficiency-driven.

Implemented behavior:

- skill use increments proficiency
- proficiency thresholds are read from `data/skills.json`
- when threshold is crossed, the active skill levels
- after the active skill reaches its normal cap, further progression feeds the aptitude counterpart
- passive levels are derived from the active skill, not upgraded independently

## Known Gaps

- non-book acquisition flows are only modeled in metadata; they are not fully implemented
- some skill classes still resolve with generic handlers instead of exact effects
- mana costs and proficiency thresholds were imported from client-derived tables and may still need spot correction
- guild-dependent Freddie renown exchange is not working from the server side because the client performs a local guild precheck before sending the exchange packet

## Freddie Exchange Finding

Freddie's renown-to-proficiency exchange has a client-side gate in `script.gcg`.

The active client script branch requires:

- guild contribution check via `macro_GetGuildGongXian()`
- guild martial club level via `macro_GuildJzLv(8)`
- `macro_TrySkillLevelUp(skillId)`
- renown
- learned skill presence

The current server does not implement guild state at all, so the client never emits the follow-up exchange packet even though the server-side exchange handler exists.

This should be resumed later as a separate task:

1. reverse the guild state packet(s) that populate client guild contribution / guild building level
2. implement minimal guild state sync on the server, or patch the client script if a server-side solution is not worth the effort

## Resume Order

1. verify `skills.json` entries that still have inferred behavior or placeholder semantics
2. refine implementation-class handlers one class at a time
3. add non-book acquisition flows
4. revisit Freddie exchange only after deciding whether to implement guild state or patch the client
