# Quest Relog Cache Fix: Approaches Taken

## Goal

Force the client to stop showing stale quest rows from account A after relogging into account B.

## Validated Facts

- The visible stale rows come from the local player quest-slot block at `entity + 0x728`.
- Zeroing `entity + 0x728` live immediately empties the quest list.
- In the stale relog state, `DAT_008f19d8` is already zero.
- `RefreshTaskListWindow` at `0x556ce0` renders mode `2` rows from the slot block at `+0x728`.
- `RefreshTaskListWindow` mode `2` does not appear to validate that the corresponding `DAT_008f19d8` record is still populated.
- `FUN_00449ff0` clears the quest tree and all 16 slot records.
- `FUN_0044ec80` definitely runs during relog, but the object there was not the live local player object.

## Attempts

### 1. Rebuild-time DAT clear

- Hook: `0x44F7B7`
- Idea: clear `DAT_008f19d8` before/around the rebuild path
- Result: failed
- Outcome: hid all quests because the rebuild loop consumed the table after it had already been zeroed
- Status: rolled back

### 2. Post-login player-install reset

- Hook: `0x41459F`
- Idea: reacquire local player after install and clear quest state there
- Result: failed
- Outcome: startup crash, Wine read fault near `0x000000CD`
- Status: rolled back

### 3. Relog wrapper slot clear

- Hook: `0x435BCC`
- Idea: on confirmed relog/session reset, clear `DAT_008f19d8` and also clear `player + 0x728`
- Result: failed
- Outcome: second-login hang and later Wine stack overflow
- Status: rolled back to DAT-only clear

### 4. `0x44EC80` tail hook

- Hook: `0x44ECF5`
- Idea: clear `esi + 0x728` inside the larger player-reset flow
- Result: failed
- Outcome: stale slots remained after restart; live trace showed this was not the live local player object
- Status: rolled back

### 5. `FUN_00447200` light-reset extension

- Hook: `0x447217`
- Idea: extend the smaller reset helper so it also calls `FUN_00449ff0`
- Result: failed
- Outcome: user still saw stale quests after restart
- Status: currently ineffective and should not be retried as the main fix path

### 6. Runtime probe: zero slot block directly

- Method: live debugger write to `entity + 0x728`
- Result: successful as a diagnostic
- Outcome: quest window immediately became empty
- Status: confirmed root cause, but not a permanent fix

### 7. Mode-2 render gate

- Hook: `0x556E22`
- Idea: keep the slot bytes untouched, but skip rendering a mode-2 row when `DAT_008f19d8[taskId].id == 0`
- Result: active current attempt at the time of the investigation
- Outcome: on-disk binary used a render-side validity gate instead of another relog-time reset hook
- Status: later abandoned along with the rest of this quest-cache work

## Safe Changes Still Kept During Investigation

- `0x435BCC` relog wrapper still clears `DAT_008f19d8`
- secondary registration patch still keeps `0x0454` and adds `0x03ff` without restoring the crashing main-table `0x07d2` path
- runtime gate patch at `0x5044E7` is still in place
- `0x447217` was returned to stock during the later attempts

## Paths To Avoid Repeating

- Do not clear `DAT_008f19d8` inside the rebuild hook at `0x44F7B7`
- Do not hook `0x41459F` again for post-player-install quest clearing
- Do not call `FUN_00449ff0` from the previous `0x44EC80` tail-hook path
- Do not reintroduce relog-wrapper slot clears at `0x435BCC`

## Best Lead Reached

Patch `RefreshTaskListWindow` mode `2` so a slot row is skipped when its task id points to an empty `DAT_008f19d8` record. That matched the validated live state:

- stale visible rows still existed in `player + 0x728`
- authoritative `DAT_008f19d8` was already zero
- a render-side gate should suppress the stale rows without depending on fragile relog/reset lifetimes
