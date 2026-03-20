# Combat

## Current Working State

- Bling Spring field combat is live again on the current server.
- Multi-enemy encounters are currently forced on for debugging when the profile supports more than one enemy.
- The current working path supports:
  - encounter entry
  - repeated target selection across multiple enemies
  - per-enemy death/hide
  - victory rewards, drops, exp, and coins
  - defeat/respawn

## Current Encounter Model

- Encounter profile `blingSpringField` supports `minEnemies=1`, `maxEnemies=3`.
- The server is currently forcing `maxEnemies` for reproducibility.
- Enemy positions are fixed to:
  - `[0,0]`
  - `[0,1]`
  - `[0,2]`
- Entity ids are allocated as:
  - `0x700001`
  - `0x700002`
  - `0x700003`

## Confirmed Turn / Action Mapping

Turn prompt rows derived from the live client:

- `2101` -> attack
- `501` -> protect-family second slot
- `7003` -> flee
- `7002` -> item

Confirmed outbound `0x03ed` subcommands:

- attack -> `0x03`
- item -> `0x05`
- flee -> `0x02`
- protect-family command -> `0x0e`
- ready / continue / settle -> `0x09`

## Important Packet Findings

### `0x03fa/0x65` Encounter

- The client accepts a multi-enemy encounter packet when the server appends multiple enemy entries after the player entry.
- Initial multi-enemy parse is not the source of the old failure.

### `0x03fa/0x03` Playback

- The client parser reads more than:
  - attacker id
  - target id
  - one result byte
  - one damage field
- The normal playback packet now includes explicit secondary fields:
  - `secondaryEntityId`
  - `secondaryHitstate`
  - `secondaryValue`
- This removed parser overread / garbage-state behavior from earlier experiments.

### Result Code Mapping

Confirmed primary result meanings in the normal playback parser:

- `0` -> normal non-lethal hit
- `2` -> critical-like visual
- `3` -> death branch
- `0x0e` -> separate ally-protect path, not self-protect

Important fix:

- Enemy retaliation was previously using result code `3`, which made the client play a player death animation.
- Retaliation now uses normal-hit result code `0`.

## Multi-Enemy Sequencing Findings

The major sequencing rule discovered from live testing:

- after a lethal player hit with surviving enemies remaining, the server must **not** immediately send a retaliation packet
- if retaliation is sent immediately after `enemy hide`, the client loses valid post-kill target state

Working current flow:

1. Player kills enemy
2. Server sends enemy death playback
3. Server sends hide packet for the dead enemy
4. Server waits for client settle / ready `0x03ed/0x09`
5. Server runs the surviving enemies' turn
6. Server reopens the command wheel once after the full enemy turn

## Enemy Turn Queue

Current enemy turn handling in the server:

- All living enemies retaliate, not just the first survivor.
- Enemy turns are queued in `pendingEnemyTurnQueue`.
- The queue is **not** driven by a fixed timeout anymore.
- Each next enemy attack waits for the client's `0x03ed/0x09` settle packet before sending the next playback packet.
- This prevents overlapping enemy attack animations.
- The wheel opens once after the full enemy turn completes.

Implication:

- The client's `0x03ed/0x09` acts as a reliable combat playback settle / continue signal, not just initial combat-ready.

## Known Simplifications

- Enemy count is still forced to multi-enemy for debugging.
- Enemy action order is still encounter-order based, not stat / initiative based.
- Protect / self-protect RE is incomplete and not the focus of the current working loop.
- The second slot is still only known as a protect-family command; true self-defend semantics are unresolved.

## Protect / Self-Protect RE Snapshot

- `500` and `501` both entered client mode `9`.
- Mode `9` is the protection-target UI path.
- Protect target selection is client-local:
  - `FIGHTCONTROL + 0x10 = 6`
  - `FIGHTCONTROL + 0x1c = selectedTargetEntityId`
- The chosen target is not serialized in `0x03ed/0x0e`.
- Ally-protect playback uses `0x03fa/0x03 result=0x0e` and a separate two-actor helper.
- That path is not valid for self-protect.

This work is paused; current combat stability work should not depend on it.

## Best Next Steps

- Make forced multi-enemy a toggle instead of always-on.
- Reduce temporary combat debug logging once validation is complete.
- Reverse-engineer initiative / stat-based action order.
- Revisit protect / self-protect only after the basic multi-enemy turn model is stable.
