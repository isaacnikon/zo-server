# Skill And Proficiency Context

## Current State

The server skill system has been generalized around repo-owned metadata instead of client archive files at runtime.

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
