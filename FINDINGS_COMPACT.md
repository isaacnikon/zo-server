# Zodiac Online RE Compressed Findings

Use this file as the fast restart point. It is intentionally shorter than `CLAUDE.md`.

## Goal
- Emulate enough of the Zodiac Online server protocol for `gc12.exe` to log in and progress through role/server selection.

## Environment
- Client: `/home/nikon/Data/Zodiac Online/gc12.exe`
- Ghidra project: `/home/nikon/ghidra/ZO.gpr`
- Ghidra MCP is working.
- `gc12.exe` is loaded in Ghidra, but `Login.dll` may be the current active program. Always pass `program:"gc12.exe"` to MCP calls.
- Client config is already pointed at `127.0.0.1:7777`.

## Transport Layer
- TCP port: `7777`
- Packet format:
  - `u8 flags`
  - `u16 len_le`
  - `u16 seq_le`
  - `payload[len]`
- Valid flags satisfy `(flags & 0xE0) == 0x40`.
- Flag bits:
  - `0x01`: XOR
  - `0x02`: compressed
  - `0x04`: special/handshake packet
- Seq starts at `0` on both sides and wraps after `65000` back to `1`.
- Bad seq closes the session.

## Handshake
- Server must send this immediately on connect:
```text
flags=0x44
seq=0
payload = [u16 cmd=1][u32 seed]
```
- `seed=0` disables XOR.
- If `seed != 0`, XOR key is:
```text
for i in 0..15:
  key[i] = (seed % 255) + 1
  seed //= 19
```

## Special Control Packets
- Special packets use `flags=0x44`.
- Known control commands inside special-packet payload:
  - `u16 cmd=1` + `u32 seed`: initial handshake from server
  - `u16 cmd=2` + `u32 tick_or_time`: client ping/keepalive
  - `u16 cmd=3` + `u32 echoed_value`: server pong reply
- `00589960` behavior:
  - `cmd=1`: install XOR key and transition connection state to active
  - `cmd=2`: client sends back `cmd=3` with the same 32-bit value
  - `cmd=3`: client computes RTT as `timeGetTime() - echoed_value`
- `00589b40` behavior:
  - while connection state is `3`, client emits ping `cmd=2` every `30000` ms
  - if too much time passes without expected activity, connection state moves to error/disconnect
- Live observation from `server.log`:
  - after login, client sends `flags=0x44`, `len=6`, payload `[02 00][u32 value]`
  - this repeats roughly every 30 seconds
- Practical implication:
  - any fake server that wants to keep the client stable must answer pings with special `cmd=3`

## Login
- Client login packet command: `0x03e9`
- Layout:
```text
u16 cmd = 0x03e9
u16 username_len_including_null
char username[]
u16 password_md5_len_including_null
char password_md5_upper_hex[]
u8 client_type = 'S'
```
- Test creds from `SETUP.INI`:
  - user: `000000`
  - pass: `123456`
  - MD5: `E10ADC3949BA59ABBE56E057F20F883E`

## Login Response
- Response command: `0x03e9`
- Critical correction:
  - normal inbound packets are dispatched by first reading a `u16 cmd` from the payload in `005008b0`
  - the fake stub previously sent only a bare result byte like `0x1f`
  - that packet was never a valid `0x03e9` login response, so `0050a590` could not run
  - this invalidates earlier behavioral conclusions drawn from those bare-result tests
- Best minimal success path currently known:
```text
u16 cmd = 0x03e9
u8 result = 0x13
u32 0
u32 0
u32 0
```
- `0x13` goes directly to role select state `4`.
- Confirmed live success path:
```text
u16 cmd = 0x03e9
u8 result = 0x1f
```
- Live result with correctly framed payload:
  - client leaves login UI and reaches server-selection UI
  - previous failures with `0x1f` were caused by malformed payloads that omitted the leading `u16 cmd`
- More complete success path is `0x03`, which includes a 3-entry server list, but a few fields remain unknown.
- Live test implication:
  - old placeholder result `0x00` is not sufficient
  - local stub should use `0x13` if the goal is to reach role select with minimum structure
  - live test with updated stub:
    - client accepts handshake + login request + `0x13` response
    - connection stays established
    - client does not immediately send a follow-up normal packet after `0x13`
    - interpretation: either role-select waits for user/UI action, or `0x13` success still expects an additional server-initiated packet to populate state
- revision:
    - earlier stub experiments with `0x03`, `0x13`, and `0x1f` used malformed payloads if they omitted the leading `u16 cmd=0x03e9`
    - any conclusions based on those bare result-byte packets should be re-tested with a correctly framed login response

## Important Client States
- `1`: server list UI
- `2`: login UI
- `4`: role select
- `8`: role create
- `0x10`: in game
- `0x40`: online/server select
- `0x80`: online select variant

## Key Functions
- `0058b730`: packet parser
- `00589730`: recv packet + seq validation
- `00589960`: special packet dispatcher (handshake/ping)
- `005895d0`: XOR key setup
- `00500390`: build login packet
- `0050a590`: login response handler
- `00514c00`: packet handler registration
- `004c0b30`: login/role state machine
- `00504500`: recv `0x44c` character-create/delete response handler
- `00504ea0`: recv `0x44d` sub-dispatcher
- `00505640`: recv `0x453`, currently looks like forwarding a string back via `0x44e`/subcmd `0x76`

## Handler Registry Notes
- Recv handlers from `00514c00`:
  - `0x03e9` -> `0050a590` login response
  - `0x044c` -> `00504500`
  - `0x044d` -> `00504ea0`
  - `0x044f` -> `0050e990`
  - `0x0453` -> `00505640`
  - `0x07d2` -> `00504460`

## `0x044c` Findings
- First byte is a subcode.
- Known subcodes:
  - `0x05`: character create success, goes back to role select
  - `0x06`: character create failed
  - `0x08`: character delete success, then reads `u8 slot`
  - `0x09`: character delete failed
  - `0x0e`: character create failed, nickname exists
  - `0x76`: reads string and sends `0x44e` with subcmd `0x76` and same string

## `0x044d` Findings
- Packet starts with `u16 subcmd`.
- Confirmed subcmd table from `00504ea0` jump table:
  - `0x27`
  - `0x28`
  - `0x33`
  - `0x3a`
  - `0x41`
  - `0x76`
- Current interpretation:
  - `0x41`: reads `u8`, then calls `00410340`; likely role slot / active role selection update
  - `0x76`: reads string and echoes/sends `0x44e` subcmd `0x76`
  - `0x28`: reads `u8`, string, `u8`; updates a `sysboard%d` UI object
  - `0x33`: reads two strings and writes to `CHATSHOW.chatshow`
  - `0x3a`: displays fixed text `"G M is busy. A moment, please!"`
  - `0x27`: reads two strings and sends them into a UI message path; exact semantics still unclear
- If subcmd is not in the small table, code falls through to `00553de0`, which currently decompiles to a stub returning `1`.

## What Is Known vs Unknown
- Known:
  - transport framing
  - seq handling
  - handshake
  - special ping/pong control packets (`cmd=2` / `cmd=3`)
  - XOR derivation
  - login request format
  - login response result table
  - `0x44c` subcodes above
  - `0x44d` subcmd IDs above
- Unknown:
  - exact role/character list packet format after login
  - exact packet that populates the role select screen with character data
  - meaning of some `0x03` login-response fields
  - full semantics of `0x44d` subcmds `0x27`, `0x28`, `0x33`
  - purpose of `0x044f` in the login-to-role flow

## Important Correction: Server-List Parse Layout
- `0050a590` calls `00502d70` for both `0x03` and `0x13`.
- `00502d70` layout:
  - clear internal server-list storage
  - read 8 raw bytes into `param_1 + 0x160 .. +0x167`
  - then parse exactly 3 server entries
- Each server entry:
  - `u32 areaID`
  - if `areaID > 0`:
    - `u16 port`
    - `u8 status`
    - length-prefixed string via `005892a0` (this is the server IP/address string)
    - `u8 unknown1`
    - `u8 unknown2`
- Consequence:
  - earlier simplified `0x13` and `0x03` packet notes were missing this 8-byte header
  - any fake `0x03`/`0x13` response without those 8 bytes misaligns the server-list parse

## Gating Fields Found In UI Logic
- `00501d70`:
  - uses the 8-byte header at `+0x160..+0x167` as per-line enable flags
  - if selected line byte is `0`, line selection fails immediately
  - server sends line number as `index + 1` in packet `0x44c` subcmd `0x1c`
- `004ce430`:
  - selected server entry must have field `+0x60 > 0` or the client shows:
    - `"This line is coming soon!"`
  - that field is populated from the server-entry `status` byte in `00502d70`
- Practical implication for fake responses:
  - 8-byte header should mark at least one line enabled, e.g. first byte `1`
  - first server entry `status` should be nonzero, e.g. `1`

## UI Transition Observations
- `004c0b30(0x40)` does not directly hide the login widgets.
- For state `0x40`, it mainly loads `script\\onlineselect.lua`.
- `00480ec0()` only updates the `lineselect` UI if a widget named `lineselect` already exists.
- Interpretation:
  - the visible transition from login screen to online/line-select depends on the UI/script layer creating and showing those widgets
  - if that script-side setup does not happen, the login form can remain visible even though the network/session state looks accepted
- This is now confirmed in practice:
  - a correctly framed login response `0x03e9 / 0x1f` transitions the client to the server-selection UI
  - therefore the login-response handler and `0x40` UI path are valid for this build
- Current experiment:
  - after sending login success, local stub now closes the socket immediately
  - rationale: the client may expect the login-server phase to terminate cleanly before the online-select UI becomes active

## Best Next Steps
- Capture the first outbound packet from the server-selection UI after successful `0x1f` login.
- With the current live stub:
  - keep the client on the server-selection screen and try explicit UI actions
  - capture whether clicking a line / confirm / enter emits the first outbound packet
- Inspect callers/users of role-select UI globals like:
  - `myrole0`
  - `myrole1`
  - `myrole2`
  - `ROLESHOWWIN`
  - `rolesel0/1/2`
- Decompile send handlers around `0x44f`, `0x453`, and nearby role-select functions.
- Run client against a fake server and log the first outbound packet after success `0x13`.
- Current local repo improvement:
  - `server.js` now sends `0x13` instead of `0x00`
  - `server.js` now replies to special ping `cmd=2` with special pong `cmd=3`

## MCP Reminders
- Ghidra MCP current program can be `Login.dll`; explicitly use `program:"gc12.exe"`.
- Useful MCP targets for this work:
  - `decompile_function`
  - `disassemble_function`
  - `search_strings`
  - `get_function_xrefs`
  - `read_memory`
