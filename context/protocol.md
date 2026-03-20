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
- `0x03f6`: active entity state update family, subtype `0x0a` applies aptitude/state
- `0x0406`: look/inspect-style path
- `0x0407`: client-side executor for `script\\serverrun\\%d.lua`
