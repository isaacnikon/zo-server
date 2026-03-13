# Zodiac Online RE Compact Findings

Use this as the restart file. It keeps confirmed facts and the current working path, not experiment history.

## Goal
- Emulate enough of the Zodiac Online protocol for `gc12.exe` to log in and continue past server selection.

## Environment
- Client: `/home/nikon/Data/Zodiac Online/gc12.exe`
- Ghidra project: `/home/nikon/ghidra/ZO.gpr`
- Client is configured to connect to `127.0.0.1:7777`
- Ghidra MCP works; explicitly pass `program:"gc12.exe"`

## Transport
- TCP port: `7777`
- Packet format:
```text
u8  flags
u16 payload_len_le
u16 seq_le
u8  payload[payload_len]
```
- Valid flags satisfy `(flags & 0xE0) == 0x40`
- Flag bits:
  - `0x01`: XOR
  - `0x02`: compressed
  - `0x04`: special/control packet
- Sequence starts at `0` on both sides
- Sequence wraps after `65000` back to `1`
- Bad sequence disconnects the client

## Handshake And Crypto
- Server must send this immediately after connect:
```text
flags=0x44
seq=0
payload:
  u16 cmd = 1
  u32 seed
```
- `seed=0` disables XOR
- If `seed != 0`, key derivation is:
```text
for i in 0..15:
  key[i] = (seed % 255) + 1
  seed //= 19
```

## Special Control Packets
- Special/control packets use `flags=0x44`
- Confirmed commands:
  - `cmd=1`: handshake
  - `cmd=2`: client keepalive/ping
  - `cmd=3`: server pong with echoed `u32`
- Client sends ping roughly every 30 seconds while active
- Fake server must reply to `cmd=2` with `cmd=3` and the same `u32`

## Login Request
- Client sends normal packet with payload:
```text
u16 cmd = 0x03e9
u16 username_len_including_null
char username[]
u16 password_md5_len_including_null
char password_md5_upper_hex[]
u8  client_type = 'S'
```
- Test creds from config:
  - username: `000000`
  - password: `123456`
  - MD5 uppercase: `E10ADC3949BA59ABBE56E057F20F883E`

## Confirmed Working Login Response
- Login response must begin with the normal command word:
```text
u16 cmd = 0x03e9
u8  result
...
```
- Confirmed working minimal path:
```text
u16 cmd = 0x03e9
u8  result = 0x1f
```
- Live-confirmed result:
  - client leaves login UI
  - client reaches server-selection UI

## Important Warning
- Earlier tests that sent only a bare result byte like `0x1f` were invalid
- Normal inbound packets are dispatched by first reading `u16 cmd`
- Without leading `u16 0x03e9`, `FUN_0050a590` cannot run

## Other Login Response Facts
- `FUN_0050a590` handles login result `0x03e9`
- Important known result paths:
  - `0x03`: server-list parse path
  - `0x13`: role-select path
  - `0x1f`: server-selection path
- `0x03` and `0x13` both call `00502d70`
- `0x1f` jumps directly to UI state `0x40`

## Server-List Parse Facts
- `00502d70` layout:
  - read 8 raw bytes into `+0x160 .. +0x167`
  - parse exactly 3 server entries
- Each server entry:
```text
u32 areaID
if areaID > 0:
  u16 port
  u8  status
  length-prefixed string   ; IP / address
  u8  unknown1
  u8  unknown2
```

## Gating Fields For `0x03` / `0x13`
- `00501d70` uses the 8-byte header at `+0x160..+0x167` as per-line enable flags
- `004ce430` requires selected entry field `+0x60 > 0`
- That field is populated from the server-entry `status` byte
- Practical implication for fake `0x03`/`0x13` responses:
  - enable at least one line in the 8-byte header
  - first server entry `status` should be nonzero

## Confirmed UI States
- `1`: server list UI
- `2`: login UI
- `4`: role select
- `8`: role create
- `0x10`: in game
- `0x40`: online/server select
- `0x80`: online select variant

## Key Functions
- `0058b730`: packet parser
- `00589730`: recv packet + sequence validation
- `00589960`: special/control packet dispatcher
- `005895d0`: XOR key setup
- `00500390`: build login packet
- `0050a590`: login response handler
- `00514c00`: handler registration
- `004c0b30`: UI/login state machine
- `00504500`: recv `0x44c`
- `00504ea0`: recv `0x44d`
- `00505640`: recv `0x453`

## Confirmed Handler Registry
- `0x03e9` -> `0050a590`
- `0x044c` -> `00504500`
- `0x044d` -> `00504ea0`
- `0x044f` -> `0050e990`
- `0x0453` -> `00505640`
- `0x07d2` -> `00504460`

## `0x044c` Findings
- First byte is a subcode
- Confirmed client send path:
  - `00501d70` sends `cmd=0x044c`
  - then `u8 subcmd = 0x1c`
  - then `u8 line_no = selected_index + 1`
  - this is the outbound line-selection packet from server-selection UI
- Live-confirmed behavior:
  - after receiving a valid `0x03` login response, selecting line 1 sends:
    - `u16 cmd = 0x044c`
    - `u8 subcmd = 0x1c`
    - `u8 line_no = 0x01`
  - client then shows `Wait a minute ,please`
  - if the server does not answer this packet, the client stays on the wait screen and retries
- Confirmed server reply for line selection:
```text
u16 cmd = 0x03e9
u8  result = 0x1b
u8  line_no
```
- Live-confirmed result:
  - this moves the client from server-selection wait state to UI state `4` (role select)
- Confirmed subcodes:
  - `0x05`: character create success
  - `0x06`: character create failed
  - `0x08`: character delete success, then `u8 slot`
  - `0x09`: character delete failed
  - `0x0e`: nickname exists
  - `0x76`: string path, forwards via `0x44e`

## `0x044d` Findings
- Packet starts with `u16 subcmd`
- Confirmed subcmds:
  - `0x27`
  - `0x28`
  - `0x33`
  - `0x3a`
  - `0x41`
  - `0x76`
- Best current interpretations:
  - `0x41`: role slot / active selection update
  - `0x28`: UI system-board style update
  - `0x33`: chat/UI string update
  - `0x3a`: displays `"G M is busy. A moment, please!"`
  - `0x76`: string forward/echo path

## Current Working Stub Facts
- Local `server.js` now does:
  - immediate handshake with `seed=0`
  - login response as properly framed `0x03e9 / 0x1f`
  - ping `cmd=2` -> pong `cmd=3`

## Next Step
- Capture the first outbound packet from role-select after successful line selection
- Most useful actions in client:
  - line-select is already confirmed
  - next work is the first role-select / character-list packet flow

## Role-Select Gate Found
- `SelectRoleIn` / `rolesel0/1/2` handler is at `0x00478520`
- It does **not** send the next packet unless one of the role widgets satisfies:
  - `byte [widget + 0x1d0] != 0`
  - `dword [widget + 0x200] >= 0`
- If a valid slot exists, it calls `005014a0(client+0x52744, slot_index)`
- `005014a0` sends:
```text
u16 cmd = 0x044c
u8  subcmd = 0x0d
u8  slot_index
```
- Current implication:
  - create success popup works
  - but the fake `0x044c / 0x05` response is still not populating role-select widgets enough for `SelectRoleIn` / Enter to become active

## Open Unknowns
- Exact packet flow after server selection
- Exact role/character list packet format
- Purpose of `0x044f` in the login-to-role flow
- Full meanings of `0x044d` subcmds `0x27`, `0x28`, `0x33`
