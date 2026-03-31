# Frog Teleporter Context

Source of truth for these notes is the live client `gc12.exe` and UI behavior, not the dumped server source.

## Main Finding

The frog teleporter UI does not consume its unlock bits from `0x0406`.

The working client path is:

- top-level command `0x0407`
- subcommand `0x4f`
- payload:
  - `u8 playerVarIndex`
  - `u32 playerVarValue`

This path reaches the local player-var setter the frog menu script reads.

## Packet Registration

Client packet registration is centered at `0x514c00`.

Relevant mappings:

- `0x0406 -> 0x505280`
- `0x0407 -> 0x5084a0`

Important distinction:

- `0x0406` is not the frog player-var sync path in this client build
- `0x0407` owns the `0x4f` case that updates local player vars

## Verified Client Handlers

### `0x0407 -> 0x5084a0`

The real player-var update case lives in the `0x0407` dispatcher.

Verified assembly path for `sub=0x4f`:

- `0x508c20`
  - reads `u8 index`
  - reads `u32 value`
  - gets local player via `0x40f1f0`
  - calls `0x441070`

### Local Player-Var Setter

The client setter is:

- `0x441070`

Behavior:

- mode `0`: assign full value
- mode `1`: OR bits
- mode `2`: clear bits

For the frog sync path, the incoming handler uses mode `0`, so the server should send the full target word value for each synced index.

### Script Macro Reference Path

The script-side helper `macro_SetPlayerVar` is at:

- `0x4a95d0`

When the client sets a player-var bit locally and chooses to notify the server, it builds:

- `0x0406 / 0x4f`

with a different payload shape than the inbound frog sync path. That outbound packet shape should not be mirrored blindly for server-to-client sync.

## Frog UI Bits

The Cloud City frog script reads these player-var gates:

- `playerVar[3] & 0x4000` -> Rainbow Valley return
- `playerVar[3] & 0x8000` -> Goal Manor
- `playerVar[3] & 0x2000` -> Timber Town
- `playerVar[5] & 0x0001` -> Chill Pass
- `playerVar[3] & 0x20000` -> Ariel Manor
- `playerVar[3] & 0x40000` -> Celestial State

Current server mapping in `frog-teleporter-service.ts` mirrors those UI gates directly.

## Server Fix

The correct frog unlock sync is:

- command `0x0407`
- subcommand `0x4f`
- payload `u8 index`, `u32 value`

Do not send frog unlock state as `0x0406 / 0x4f` or `0x0406 / 0x61` on this client build.

## Good Restart Points

If this breaks again, restart from:

- registration table at `0x514c00`
- `0x5084a0` for `0x0407`
- `0x508c20` for inbound player-var assignment
- `0x441070` for the local player-var setter
- Cloud City frog script `4014` and the `macro_IsPlayerVar(...)` checks in `script.gcg`
