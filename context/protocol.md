# Protocol Notes

## Client and Transport
- Client root: `/home/nikon/Data/Zodiac Online/`
- Main executable: `gc12.exe`
- Login DLL: `Login.dll`
- Local dev server points to `127.0.0.1`

Packet layout:

```text
0: flags
1: u16 payload_len
3: u16 sequence
5: payload
```

- Valid flags satisfy `(flags & 0xE0) == 0x40`
- Sequence starts at `0`, wraps after `65000` to `1`
- `0x01`: XOR encrypted
- `0x02`: compressed
- `0x04`: special/control packet
- Seed `0` disables XOR

Handshake:

```text
flags=0x44
payload: u16 cmd=1, u32 seed
```

Special/control packets:
- `cmd=1`: handshake
- `cmd=2`: client ping
- `cmd=3`: server pong

## Login Flow
- Login packet: `0x03e9 + username + MD5(password) + 'S'`
- Session 1 is login, session 2 is game
- Login to game handoff: `0x03e9 / 0x0d`
- Enter-game success: `0x03e9 / 0x03`

## Important Game Packets
- `0x03eb`: position/map/entity query family
- `0x03ec`: mixed status/UI family; not a reliable generic fight-start signal
- `0x03ed`: fight action family
- `0x03ee`: fight result/status family
- `0x03f0`: fight turn/round family
- `0x03f1`: server-run/message family
- `0x03f6`: active entity state update family, subtype `0x0a` applies aptitude/state
- `0x03fa`: main fight stream family
- `0x0406`: look/inspect-style path, not fight start
- `0x0407`: client-side executor for `script\\serverrun\\%d.lua`

## Confirmed Combat Behavior
- `0x03fa / 0x65` is the only confirmed synthetic fight-enter packet in the current harness.
- `0x03fa / 0x34` opens or refreshes `FIGHTCONTROL`.
- `0x03fa / 0x33` is a per-entity fight-control/state update keyed by `u32 entity_id`.
- `0x03fa / 0x01` is the strongest confirmed ring-open control packet:
  - it looks up the active entity in the fight table
  - runs the `FIGHTCONTROL` macro/open path
  - sets `GetGameObject()->0x3bbc = 1`
- `0x03fa / 0x02` clears/reset fight-control state and runs a `FIGHTCONTROL` open/refresh macro.
- `0x03fa / 0x03` is a structured active-slot state packet and also the primary normal-attack playback packet.
- `0x03fa / 0x66` and `0x03fa / 0x67` are structured aftermath/state packets, not the primary hit animation.
- `0x03fa / 0x0a` is tied to summon/pet flow and should not be used as generic startup state.
- `0x03f0` is structured turn/action data and does not start combat by itself.

## `0x03fa / 0x65` Current Wire Shape

Current client-accepted synthetic shape:

```text
u32 active_entity_id
player row:
  u8  side
  u32 entity_id
  u16 type_id
  u8  row
  u8  col
  u32 hp_like
  u32 mp_like
  u8  aptitude
  u16 level_like
  repeat 3 times:
    u16 appearance_type
    u8  appearance_variant
  string name   // u16 byte length + bytes, must include trailing NUL
enemy row:
  u8  side
  u32 entity_id
  u16 type_id
  u8  row
  u8  col
  u32 hp_like
  u32 mp_like
  u8  aptitude
  u16 level_like
```

Important findings:
- The per-entry `side` byte is mandatory.
- Zero-length names are rejected.
- Player/enemy battlefield positions were corrected by using:
  - player `side = 0xff`
  - enemy `side = 1`
- The player row and enemy rows do not use the same tail shape.
- Sending the extended tail for enemy rows caused the multi-enemy startup parse to shift.

## Multi-Enemy Popup Root Cause
- `Combat data error!` popup path in `gc12.exe`:
  - failure branch `0x005227db -> 0x00522809`
  - success path calls `0x00519bf0`
- `0x00519bf0` validates a board-placement tuple and rejects invalid row/col/side values.
- At the multi-enemy failure breakpoint, the client had decoded:
  - `row = 2`
  - `col = 3`
  - `side = 0x78`
- `0x78` is decimal `120`, matching the synthetic enemy HP.
- This proved the second enemy row was being misaligned and the client was reading the side byte from the previous row’s HP field.
- Fix:
  - serialize the player row with the extended tail
  - serialize enemy rows in short/base form only
- Result:
  - `Combat data error!` is gone
  - multi-enemy startup no longer dies in the old popup path

## `0x03fa / 0x03` Playback Shape

Working normal attack playback:

```text
u32 attacker_runtime_id
u32 target_runtime_id
u8  result_code
u32 damage
```

- This is sufficient for visible attack animation.
- `result_code = 1` works for normal hit playback.

## `0x03f0` Turn Packet
- Handler path:
  `HandleGamePacket03f0 -> FUN_00431a40 -> FUN_0054ce10 -> FUN_0054cd70`
- Shape for `mode == 0`:

```text
u8  mode
u16 count
repeat count:
  u16 field_a
  u16 field_b
  u16 field_c
```

- `field_a` is the action-definition lookup id
- `field_b` is a runtime/setup level/index
- `field_c` is another setup field copied into the action object
- `0x03f0` only makes sense after fight mode exists

## Command Ring Notes
- Top-level command wheel is tied to client state `GetGameObject()->0x3bbc`.
- `FIGHTCONTROL.skill` only builds the skill submenu; it is not the outer ring.
- The client sends bare `0x03ed / 0x09` packets as readiness/advance signals during the fight loop.
- The harness currently reopens commands using `0x03fa / 0x01`, `0x03fa / 0x34`, then `0x03f0`.

## Attack Flow
- Client attack click sends `0x03ed / 0x03` followed by three bytes.
- Original server path:
  - packet handler `0x00463130`
  - then `0x00430380`
  - then `0x0043ae30`
- Normal attack mode is `3`.
- Synthetic server now handles:
  - player attack selection
  - playback via `0x03fa / 0x03`
  - queued enemy turns
  - player HP sync via `0x03f6 / 0x0a`

## Current Stable State
- Single-enemy startup: stable
- Multi-enemy startup: popup fixed
- Multi-enemy fight loop exists, but remaining turn-flow/UI polish may still need work
