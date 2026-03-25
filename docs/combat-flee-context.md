# Combat Flee Context

Date: 2026-03-25

## Summary

Escape/flee is now recognized and handled server-side, but the client appears to be missing the expected flee animation/playback sequence.

The combat does end. This is no longer a packet-recognition problem.

## Confirmed Client Packet

The escape button sends:

- command: `0x03ed` (`GAME_FIGHT_ACTION_CMD`)
- subcommand: `0x02`
- raw packet: `ed0302`

This was confirmed in `server.log` and `data/runtime/skill-packet-trace.jsonl`.

## Current Server Behavior

Implemented in:

- `src/handlers/combat-handler.ts`
- `src/combat/combat-resolution.ts`

Current flee path:

1. receive `ed0302`
2. call `resolveCombatFlee(...)`
3. send combat result packet with zero rewards via `buildVictoryPacket(...)`
4. clear combat state
5. send action-state reset / table reset
6. resume normal field sync

## What Logs Show

Example from `server.log`:

```text
Combat flee source=cmd=0x3ed sub=0x2 trigger=field:102:44:34 round=1
Sending combat flee result hp=6165 mp=5292 rage=100
> ... fa 03 66 ...
Sending combat action-state reset cmd=0x040d entity=1021 reason=combat-clear
```

Multiple flee attempts in a row succeeded with the same pattern:

- `17:17:13`
- `17:17:39`
- `17:17:54`

After flee, the player can immediately trigger new field combats at new positions, so the battle state is definitely being cleared.

## Current Diagnosis

The remaining issue is likely visual/protocol sequencing:

- flee is handled
- combat exits
- but the client does not receive a dedicated flee animation/playback packet before the final result packet

Normal combat actions send a playback stage first:

- attacks use `buildAttackPlaybackPacket(...)`
- skills use `buildSkillCastPlaybackPacket(...)`

Flee currently skips straight to the end-state/result packet.

## Most Likely Missing Piece

Need to identify the outbound packet sequence that the client expects for:

- escape animation
- retreat playback
- or a specific combat stream/event before `0x66`

Most likely this is a `0x03fa` packet or another combat playback/state transition packet, not just the final result packet.

## Recommended Next Debugging Steps

1. Compare flee against a known working client/server capture if available.
2. Search existing protocol research for a retreat/flee animation packet.
3. Instrument the flee path and test alternative pre-result packets before `buildVictoryPacket(...)`.
4. Check whether the client expects:
   - a special `0x03fa` playback subcommand
   - an entity movement/hide sequence
   - a `0x03ec` / state-mode transition
   - or a different result subtype than `0x66`

## Relevant Files

- `src/handlers/combat-handler.ts`
- `src/combat/combat-resolution.ts`
- `src/combat/packets.ts`
- `src/config.ts`
- `server.log`
- `data/runtime/skill-packet-trace.jsonl`

## Notes

- Only `.ts` files were changed for flee support.
- The running server uses `dist/src/server.js`, so rebuild/restart is required after future TypeScript changes.
