# Skill Exploration Playbook

Use this when reverse-engineering a combat skill from the client.

## Ground Rules

- Client is the only source of truth: `gc12.exe`, live packets, client tables, live debugger.
- Do not use dumped server code to decide behavior.
- Rename client functions in Ghidra once the role is clear enough to survive reuse.
- Update context docs as soon as a probe is confirmed or disproved.
- Change one wire variable at a time.

## Workflow

1. Lock the skill identity.

- Record the learned skill id, passive `10000 + skillId`, aptitude `20000 + skillId`, and any nearby hidden rows.
- Check `magic.txt`, per-skill `.TXt`, and effect rows before changing the server.
- Do not assume a hidden row is a packet alias until runtime proves the client actually uses it.

2. Capture the baseline cast.

- Save the outbound `0x03fa sub=0x04` packet hex.
- Record `packetSkillId`, `actionCode`, `value`, target ids, and whether there is a `sub=0x03` or `sub=0x06` around it.
- Note whether the skill is one-shot, delayed, or selector-sensitive.

3. Classify the packet family first.

- `Slaughter` / `Blizzard`: native prelude family.
- `Cure`: generic `sub=0x04` cast, but popup family decided later by queued effect case.
- If the first packet becomes mostly invariant and the real targets move into a second delayed packet, treat it as a prelude candidate.

4. Follow the exact client path.

- Start at `HandleCombatCommandPacket_03FA`.
- Identify the real parser branch for the subcommand.
- Track where the packet fields go:
  - loaded skill row
  - queued slot transition state
  - queued effect/result case
  - popup amount/style

5. Compare row data only after the parser path is known.

- Compare learned and hidden rows side by side.
- Focus on fields that differ across known-working families.
- Prove row usage with a live breakpoint on the client path, not by table shape alone.

6. Probe one lever at a time.

- Valid levers:
  - `packetSkillId`
  - `actionCode`
  - `targetValue` sign/encoding
  - prelude/follow-up shape
  - selector/round-control prereqs
- After each probe, check both:
  - server trace
  - client breakpoint on the downstream branch you are trying to change

7. Stop repeating disproved probes.

- If a row change still lands in the same queued result case, the row is not the lever.
- If a sign change still lands in the same popup family, the sign is not the lever.
- If a parser switch looks incomplete, verify the later popup/result handler before concluding the meaning of an action code.

## Lessons From Recent Skills

### Slaughter

- The hidden prelude was discovered from wire shape, not from static tables first.
- The key signal was:
  - first `sub=0x04` packet became target-independent
  - second delayed `sub=0x04` packet carried the real targets/results
- Fixed effect ids and delayed follow-up mattered more than simple packet skill id swaps.

### Blizzard

- Treat it as the same native-prelude family until the client disproves that.
- Verify the cast profile and delayed follow-up path before tuning damage/result details.

### Cure

- Targeting and heal formula were not the popup bug.
- `24103` existed and the client really loaded it, but it still landed in queued result case `1`.
- Negative values reached the heal math branch, but the popup stayed red because the later queued result case was still offensive.
- The real fix was changing the packet result family to the client recovery-style case, not changing the row again.

## Minimum Capture Template

- skill id family:
- baseline packet hex:
- client parser function:
- loaded row id:
- queued state / result case:
- popup caller/function:
- disproved probes:
- confirmed fix:

## Anti-Loop Rule

Do not run another packet experiment until you can name which downstream client field you expect to change.
