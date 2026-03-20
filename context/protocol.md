# Protocol Notes

## Status
- Combat-specific protocol notes were intentionally cleared on 2026-03-20.
- Treat combat packet behavior as unknown until re-verified from fresh captures.

## Stable Non-Combat Baseline
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
- `0x03ec`: mixed status/UI family
- `0x03f1`: server-run/message family
- `0x03f6`: active entity state update family
  - subtype `0x0a`: full self-state/aptitude packet
    - contains aptitude, hp/mp/rage, level, exp, currencies, attributes, status points, pet capacity
    - client parser hardcodes `old_level = 1` before calling the additive stat updater
    - repeated use as a live refresh packet inflates displayed baseline attributes by `level - 1`
  - subtype `0x0c`: lightweight self-state updates
    - confirmed discriminator bytes:
      - `'$'` gold
      - `'N'` coins
      - `'-'` renown
      - `'!'` experience
    - HP/MP/rage cases are still unknown
- `0x0406`: look/inspect-style path
- `0x0407`: client-side executor for `script\\serverrun\\%d.lua`

## Shared Item Operations
- `0x03ee / sub=0x02 / u32 instanceId`
  - discard item
- `0x03ee / sub=0x03 / u32 instanceId`
  - use item on self/default target
- `0x03ee / sub=0x08 / u32 instanceId / u32 targetEntityId`
  - use item on explicit target
  - confirmed pet-target use shape

## Client Vitals Refresh Findings
- Full self-state `0x03f6 / 0x0a` is not a safe live HP/MP refresh packet.
- The client has direct vitals update helpers:
  - `0x441320` current HP
  - `0x441380` current MP
  - `0x4413d0` third meter
- Consumable processing around `0x4495c7` reads item effect fields and calls those helpers directly.
- The correct immediate HUD refresh path is likely tied to that consumable-effect handler, not to `0x03f6 / 0x0a`.
