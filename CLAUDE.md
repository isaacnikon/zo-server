# Zodiac Online Server - Reverse Engineering Notes

## Game Client
- **Location:** `/home/nikon/Data/Zodiac Online/`
- **Main executable:** `gc12.exe` (2.3MB, Feb 2010, x86 PE32)
- **Login DLL:** `Login.dll` (268KB) — exports `AesEncrypt`, `AesDecrypt` (CryptoPP library)
- **Run via:** Wine

## Ghidra Project
- **Project:** `/home/nikon/ghidra/ZO.gpr`
- **Loaded program:** `gc12.exe` — fully analyzed, 9241 functions
- **Ghidra HTTP API:** `http://127.0.0.1:8089/`
- **MCP bridge:** `/home/nikon/projects/ghidra-mcp/bridge_mcp_ghidra.py`
- **MCP config:** `/home/nikon/projects/zo-server/.mcp.json`

## Server Configuration (Client-side)
Files pointing to server IP (all updated to `127.0.0.1` for local dev):
- `ServerConfig.ini` — `IpAddress=127.0.0.1`, `Port=7777`
- `serverlist.ini` — server name `Luna(Smooth)`, `ip=127.0.0.1`, `port=7777`, `areaname=6101`
- `SETUP.INI` — `[server] ip=127.0.0.1 port=7777`
- `PetSetup.INI` — also has server IP (written at runtime by gc12.exe)
- `ini/chat.ini` — Chat server `IP=127.0.0.1`, `PORT=8080`

## Network Protocol (TCP, port 7777)

### Packet Format (confirmed via decompile of `FUN_0058b730`)
```
Offset  Size  Description
------  ----  -----------
0       1     Flags byte  — must satisfy: (byte & 0xE0) == 0x40
                           Valid range: 0x40–0x5F
1       2     Payload length (uint16 LE, max 0x4000 = 16384)
3       2     Sequence number (uint16 LE)
5       N     Payload (N = length bytes)

Total packet size = 5 + payload_length
```

### Sequence Numbers
- Both client and server track sequence numbers (starts at 0)
- Server validates seq num matches expected; mismatch closes the connection
- Seq wraps: after 65000 resets to 1

### Encryption / Obfuscation
- `Login.dll` exports `AesEncrypt` / `AesDecrypt` (CryptoPP) — but NOT used in the main packet layer
- Actual packet obfuscation is **XOR** only (not AES) — `FUN_0058b860`
- XOR key is 16 bytes derived from a server-provided seed:
  ```
  for i in 0..15: key[i] = (seed % 255) + 1; seed //= 19
  ```
- Seed=0 disables XOR entirely
- Flags bit 0 (0x01) = XOR encrypted; bit 1 (0x02) = LZ compressed; bit 2 (0x04) = handshake marker
- `FUN_0058b8b0` checks bit 0, `FUN_0058b9a0` checks bit 1, `FUN_0058b9c0` checks bit 2

## Key Functions (gc12.exe)

| Address    | Description |
|------------|-------------|
| `0040fb80` | Login connect entry — reads IP/port, calls `FUN_00501080`, writes to PetSetup.INI |
| `00501080` | Check already logged in (`+0x90 == 4`), calls `FUN_00589360` |
| `00589360` | Socket connect — calls WSA init (`0058b480`), resolve (`0058b160`), connect (`0058b210`) |
| `0058b730` | **Packet parser** — validates flags, reads length+seq, copies into internal buffer |
| `00589730` | **RecvPacket** — calls parser, validates seq number, calls decrypt |
| `00589ba0` | **Connection state machine** — states 1–5 |
| `00589960` | Handshake/ping dispatcher — processes packets with bit 2 set; cmd=1→setup XOR, cmd=2→reply ping |
| `005895d0` | XOR key setup from seed |
| `00514c00` | **Packet handler registration** — registers all send/recv handlers by cmd ID |
| `00500390` | **Send login packet** — builds cmd=0x3e9 with username + MD5 password + 'S' |
| `0050a590` | **Login response handler** (recv cmd=0x3e9) — parses result byte + server list |
| `00502d70` | Parse server list from packet into internal struct |
| `004c0b30` | **Login state machine** — state 1=serverlist, 2=login input, 4=role select, 8=role create, 0x10=ingame |
| `004ce430` | Server list selection handler — reads entries, connects to chosen server |
| `004cbe60` | Process login result from server list struct (offset +5 = result byte) |
| `004cbf20` | Server list UI update — called every frame from main loop |
| `004c1230` | Main update function (called from main loop) |
| `0052d5b0` | Disconnect from login server |

### Packet reader helpers (all `__thiscall` on recv-buffer object)
| Function   | Reads |
|------------|-------|
| `00589210` | 1 byte |
| `00589240` | 2 bytes (uint16 LE) |
| `00589270` | 4 bytes (uint32 LE) |
| `005892a0` | length-prefixed string: `uint16 len` + `len` bytes (null-terminated, returns pointer) |

## Connection State Machine (`FUN_00589ba0`)
State stored at connection object `+0x0c`:
- **State 1** — TCP connecting. Waits for socket ready (30s timeout) → State 2
- **State 2** — Waiting for server handshake (packet with flags bit 2 set). Calls `FUN_00589960` → State 3
- **State 3** — Active session. "Special" packets (bit 2 set) handled by `FUN_00589960` (ping/pong); normal packets dispatched via `vtable[1]`
- **State 4/5** — Disconnect/error

## Server Handshake (MUST be sent first, immediately on connect)
```
Server → Client:
  flags=0x44, seq=0
  payload: [uint16 LE cmd=1][uint32 LE seed]
```
- `cmd=1`, `seed=0` → no XOR encryption
- `seed != 0` → XOR key derived; subsequent packets use bit 0 set in flags

## Login Packet (Client → Server, cmd=0x3e9)
Captured payload hex:
```
e9 03             cmd=0x03e9 (uint16 LE)
07 00             username_len=7 (uint16 LE, includes null)
30 30 30 30 30 30 00   "000000\0"
21 00             pw_hash_len=33 (uint16 LE, includes null)
45 31 30 41 44 43 ... 45 00   MD5("123456") uppercase + null
53                client type 'S'
```
- Password is MD5 of plaintext, uppercase hex string, null-terminated
- `FUN_00500390` builds this packet; `FUN_00588f40` writes length-prefixed strings

## Login Response (Server → Client, cmd=0x3e9) — `FUN_0050a590`

### Result byte (first byte of payload)
| Code | Meaning |
|------|---------|
| `0x03` | **Success** — parse server list, disconnect login, go to server select UI (state 0x40) |
| `0x13` | **Success** — go directly to role select (state 4) — still sends empty server list |
| `0x15` | **Success** — go to online select (state 0x80), reads 2 extra bytes first |
| `0x1f` | Go to server select UI (state 0x40) directly, no server list data needed |
| `0x01` | "Account error!" + disconnect |
| `0x0a` | "Account in use!" |
| `0x0b` | "Read role error!" |
| `0x0c` | "Game version number error. Please confirm to update to latest version!" |
| `0x0d` | Server redirect (reads IP/area/port) |
| `0x0f` | "Server hasn't start!" |
| `0x10` | "Inactivated account!" |
| `0x11` | "Server is full!" |
| `0x12` | Account banned until timestamp (reads uint32 Unix timestamp) |
| `0x14` | "Connect restricted. Please re-log in at..." (reads timestamp) |
| `0x16` | Redirect to new login server (reads string IP + uint16 port, reconnects) |
| `0x17` | "Verification error!" |
| `0x1a` | "Line is crowded!" |
| `0x1b` | Go to role select (reads 1 byte first) |
| `0x20` | "Password error!" (also resets to state 1 = server list) |
| default | "Password error!" |

### For result `0x03` (recommended success path)
```
byte  0x03                     result = success
byte  ?                        field1 (cStack_10f) — unknown, send 0x00
byte  ?                        field2 (cStack_10e) — unknown, send 0x00
uint32 LE ?                    field3 — unknown, send 0x00000000
--- server list (3 entries, parsed by FUN_00502d70) ---
Entry 0 (valid server):
  uint32 LE  areaID            if 0, entry is skipped
  uint16 LE  port              game server port
  byte       status            status type byte
  uint16 LE  ip_len            length of IP string (NOT including null)
  bytes      ip_bytes          IP string bytes (no null)
  byte       ?                 unknown byte 1
  byte       ?                 unknown byte 2
Entry 1 (empty):
  uint32 LE  0x00000000        → skip
Entry 2 (empty):
  uint32 LE  0x00000000        → skip
--- after server list ---
uint16 LE  str_len             length-prefixed string (FUN_005892a0) — send empty: 0x0000
byte  ?                        extra flag byte — send 0x00
```

### For result `0x13` (simplest — direct to role select)
```
byte  0x13
uint32 LE  0x00000000          empty server entry 0
uint32 LE  0x00000000          empty server entry 1
uint32 LE  0x00000000          empty server entry 2
```

## Login State Machine (`FUN_004c0b30`)
| State | Meaning |
|-------|---------|
| 1     | Show server list UI |
| 2     | Show login input (ACCOUNTINPUT.name / .password) |
| 4     | Role select screen (runs `script/onroleselect.lua`) |
| 8     | Role create screen (runs `script/onrolecreate.lua`) |
| 0x10  | Enter game world |
| 0x40  | Online/server select (runs `script/onlineselect.lua`) |
| 0x80  | Online select variant |

## Packet Handler Registry (`FUN_00514c00`)
- `FUN_00501480(cmd, handler)` = register SEND handler
- `FUN_00501060(cmd, handler)` = register RECV handler
- Key recv handlers: `0x3e9`→`FUN_0050a590` (login resp), `0x44c`→`FUN_00504500` (char create resp), `0x7d2`→`FUN_00504460`

## TODO — Still Need to Determine
- [ ] Exact values for `field1`, `field2`, `field3` in the 0x03 response
- [ ] `status` byte meaning in server list entry
- [ ] Character select packet format (cmd=0x44c area)
- [ ] Role/character list packet format after logging in
- [x] ~~Login packet payload format~~ — cmd=0x3e9 + username + MD5 + 'S'
- [x] ~~Login response result byte~~ — full table documented above
- [x] ~~Login response server list format~~ — 3-entry struct via FUN_00502d70
- [x] ~~AES key and IV~~ — XOR only, no AES in packet layer
- [x] ~~Server→client handshake~~ — cmd=1 + uint32 seed, flags=0x44
- [x] ~~Initial sequence number~~ — server starts at 0

## Test Credentials (from SETUP.INI)
- Username: `000000`
- Password: `123456` → MD5 = `E10ADC3949BA59ABBE56E057F20F883E`

## Tools
- **Packet capture proxy:** `capture.js` — listens on :7777, logs hex dumps
- **MCP:** Ghidra MCP via `.mcp.json` → `bridge_mcp_ghidra.py` → `http://127.0.0.1:8089/`
