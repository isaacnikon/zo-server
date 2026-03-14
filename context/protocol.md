# Protocol Notes

## Client and Config
- Client root: `/home/nikon/Data/Zodiac Online/`
- Main executable: `gc12.exe`
- Login DLL: `Login.dll`
- Local dev server config points to `127.0.0.1`

## Packet Format
Offset layout:

```text
0:  flags
1:  u16 payload_len
3:  u16 sequence
5:  payload
```

- Valid flags satisfy `(flags & 0xE0) == 0x40`
- Sequence starts at `0`, wraps after `65000` to `1`

## Packet Flags
- `0x01`: XOR encrypted
- `0x02`: compressed
- `0x04`: special/control packet

## Encryption
- Transport uses XOR, not AES
- XOR key is derived from server seed
- Seed `0` disables XOR

## Handshake
First packet from server:

```text
flags=0x44
payload: u16 cmd=1, u32 seed
```

Special/control packets:
- `cmd=1`: handshake
- `cmd=2`: client ping
- `cmd=3`: server pong

## Login Flow
- Login packet is `0x03e9 + username + MD5(password) + 'S'`
- Session 1 is login
- Session 2 is game
- Real login->game handoff is `0x03e9 / 0x0d`
- Enter-game success is `0x03e9 / 0x03`

## Important Game Packets
- `0x03eb`
  Position/map/entity query family. Client also sends current `x/y/mapId`.
- `0x03f1`
  Server-run/message family. Client uses it for travel/script requests.
- `0x03f6`
  Active entity state updates. Subtype `0x0a` applies aptitude.
- `0x0407`
  Client-side executor for `script\\serverrun\\%d.lua`

## Confirmed `0x03f1` Behavior
- `macro_ServerRunScript(a, b)` in Lua sends client->server `0x03f1`
- The client does not send destination map/x/y in travel requests
- `.b` map data does not encode destination either
- Server must map `(mapId, subtype, scriptId, and sometimes x/y)` to the destination

### `0x03f1 / sub=0x01`
- Used heavily for standing teleports and message/help actions
- Example:
  - Peach Garden standing teleporter: `0x03f1 / sub=0x01 / script=1 / map=209`

### `0x03f1 / sub=0x02`
- Used by higher-context scripted flows
- Apollo film exit is confirmed as:
  - `0x03f1 / sub=0x02 / mode=0xfe / contextId=12 / extra=0 / script=20001`
  - Bytes: `f1 03 02 fe 0c 00 00 21 4e`

## Confirmed `0x0407` Behavior
- `0x0407 / 'z'`
  Immediate local `script\\serverrun\\%d.lua`
- `0x0407 / '{'`
  Stores script id for later execution

Replying with `0x0407 / 'z' / 1000` is valid, but it only drives the generic onboarding/help branch. It does not reproduce the Apollo film/world transition.
