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

### Packet Format (confirmed via decompile of `0058b730`)
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

### Flag Bits
- `0x01` — XOR encrypted
- `0x02` — LZ compressed
- `0x04` — special/control packet (handshake marker)

### Encryption / Obfuscation
- `Login.dll` exports `AesEncrypt` / `AesDecrypt` (CryptoPP) — but NOT used in the main packet layer
- Actual packet obfuscation is **XOR** only (not AES) — `0058b860`
- XOR key is 16 bytes derived from a server-provided seed:
  ```
  for i in 0..15: key[i] = (seed % 255) + 1; seed //= 19
  ```
- Seed=0 disables XOR entirely

## Key Functions (gc12.exe)

| Address    | Name (renamed in Ghidra)       | Description |
|------------|-------------------------------|-------------|
| `0040fb80` | —                             | Login connect entry — reads IP/port, writes to PetSetup.INI |
| `00501080` | —                             | Check already logged in (`+0x90 == 4`), calls socket connect |
| `00589360` | —                             | Socket connect — WSA init, resolve, connect |
| `0058b730` | —                             | **Packet parser** — validates flags, reads length+seq |
| `00589730` | —                             | **RecvPacket** — calls parser, validates seq, calls decrypt |
| `00589ba0` | —                             | **Connection state machine** — states 1–5 |
| `00589960` | —                             | Handshake/ping dispatcher — cmd=1→XOR setup, cmd=2→pong |
| `005895d0` | —                             | XOR key setup from seed |
| `00514c00` | `RegisterPacketHandlers`      | Registers all handlers for both login and game server connections |
| `00501480` | —                             | Registers handler in **game server** connection's handler table |
| `00501060` | —                             | Registers handler in **login server** connection's handler table |
| `00500390` | —                             | **Send login packet** — cmd=0x3e9 + username + MD5 + 'S' |
| `0050a590` | `HandleLoginResponse`         | Login server recv handler for cmd=0x3e9 |
| `0050a200` | `GameServerLoginResponse`     | Game server recv handler for cmd=0x3e9 (enter game) |
| `00502d70` | —                             | Parse server list from packet |
| `004c0b30` | —                             | **Login state machine** |
| `004ce430` | —                             | Server list selection handler |
| `004c1230` | —                             | Main update function (called from main loop) |
| `00478520` | —                             | **SelectRoleIn** — role-select Enter handler |
| `005014a0` | —                             | Send role-select packet: cmd=0x044c/0x0d/slot |
| `00501d70` | —                             | Send line-selection packet: cmd=0x044c/0x1c/line_no |
| `00504500` | `Handle044c`                  | Recv handler for cmd=0x044c (character/role) |
| `00504ea0` | —                             | Recv handler for cmd=0x044d (role/UI updates) |
| `0050e990` | —                             | Recv handler for cmd=0x044f |
| `00505640` | —                             | Recv handler for cmd=0x0453 |
| `00504460` | —                             | Recv handler for cmd=0x07d2 |
| `004113b0` | `LoadMapAndEnterGame`         | Reads mapset.ini, calls LoadMapFiles, calls SetUiState(0x10) on success |
| `0042e900` | `LoadMapFiles`                | Loads .map, .eft, .cel, .lit, .mon files via GCG VFS or disk |
| `0042e0b0` | `MapDataLoad`                 | Loads .map file via VFS/disk |
| `00422630` | `MapCelLoad`                  | Loads unnamed format (cel?) via VFS/disk |
| `0042e6c0` | `MapEftLoad`                  | Loads .eft file via VFS/disk |
| `00436930` | `ReadEntityFromPacket`        | Reads entity fields from recv buffer into entity struct |
| `00444790` | `LookupEntityTemplate`        | Looks up entity type in template table; returns 0 if invalid |
| `00441490` | —                             | Applies live aptitude/Strength Type to entity (`entity+0x650`) and copies `zizhi` stat multipliers |
| `0040f200` | `GetGameObject`               | Returns main game object ptr (`DAT_0064328c`) |
| `0040f1f0` | `GetActiveEntity`             | Returns active player entity ptr (`DAT_0064328c + 0x526e8`) |
| `00560a60` | `VfsLookupFile`               | Looks up filename in GCG VFS, returns file data + size |
| `0058a170` | `LoadFileVfsOrDisk`           | Loads file: VFS if `DAT_0092139c != 0 && param3 != 0`, else direct fopen |
| `0058a4c0` | `IniGetValue`                 | Reads key from loaded INI, returns alloc'd string or sentinel |
| `0058a790` | `IniLoadFile`                 | Loads INI file into memory |
| `00589cc0` | —                             | Sets `DAT_0092139c = 1` (VFS enabled) |
| `00561f90` | —                             | Loads and registers a GCG pack file into VFS |
| `00413ca0` | —                             | Game init — loads GCG packs, inits VFS, inits entity templates |

### Packet reader helpers (all `__thiscall` on recv-buffer object)
| Function   | Reads |
|------------|-------|
| `00589210` | 1 byte |
| `00589240` | 2 bytes (uint16 LE) |
| `00589270` | 4 bytes (uint32 LE) |
| `005892a0` | length-prefixed string: `uint16 len` + `len` bytes (null-terminated, returns pointer) |

## Connection State Machine (`00589ba0`)
State stored at connection object `+0x0c`:
- **State 1** — TCP connecting. Waits for socket ready (30s timeout) → State 2
- **State 2** — Waiting for server handshake (packet with flags bit 2 set) → State 3
- **State 3** — Active session. Special packets (bit 2) → ping/pong; normal → vtable dispatch
- **State 4/5** — Disconnect/error

## Server Handshake (MUST be sent first, immediately on connect)
```
Server → Client:
  flags=0x44, seq=0
  payload: [uint16 LE cmd=1][uint32 LE seed]
```
- `cmd=1`, `seed=0` → no XOR encryption

## Special/Control Packets (flags=0x44)
| cmd | Direction | Description |
|-----|-----------|-------------|
| 1   | S→C | Handshake with seed |
| 2   | C→S | Keepalive/ping |
| 3   | S→C | Pong — echo back the `u32` from cmd=2 payload |

Client sends ping roughly every 30 seconds.

## Login Packet (Client → Server, cmd=0x3e9)
```
u16  cmd = 0x03e9
u16  username_len (includes null terminator)
char username[]
u16  password_md5_len (includes null terminator)
char password_md5_upper_hex[]
u8   client_type = 'S'
```
MD5("123456") = `E10ADC3949BA59ABBE56E057F20F883E`

## Packet Handler Architecture (RegisterPacketHandlers / `00514c00`)

Two separate handler tables, registered at startup via different functions:

### Login Server handlers (`FUN_00501060`):
| cmd    | Handler      | Description |
|--------|-------------|-------------|
| `0x3e9` | `HandleLoginResponse` (`0050a590`) | Login response — result byte → state machine |
| `0x44c` | `Handle044c` (`00504500`) | Character/role packets |
| `0x44d` | `00504ea0`  | Role/UI updates |
| `0x44f` | `0050e990`  | unknown |
| `0x452` | `00447710`  | unknown |
| `0x453` | `00505640`  | unknown |
| `0x454` | —           | unknown |
| `0x7d2` | `00504460`  | unknown |
| `0x7d5` | `005124d0`  | unknown |
| `999`   | `00514830`  | unknown |

### Game Server handlers (`FUN_00501480`):
| cmd    | Handler      | Description |
|--------|-------------|-------------|
| `0x3e9` | `GameServerLoginResponse` (`0050a200`) | Enter game — result 0x03 loads map |
| `0x3eb` | `HandleGamePacket03eb` (`005047e0`) | Map/entity query family; client also sends current `x/y/mapId` |
| `0x3f1` | `HandleGamePacket03f1` (`0050bda0`) | Server→client message/display packet family |
| `0x3f6` | `HandleGamePacket03f6` (`00504b90`) | Active-entity subtype update packet; subtype `0x0a` applies live aptitude |
| `0x3fd` | `00504bf0`  | unknown game cmd |
| `0x403` | `00504840`  | unknown |
| `0x407` | `HandleGamePacket0407` (`005084a0`) | Client-side `script\\serverrun\\%d.lua` executor |
| `0x44f` | `0050d2f0`  | unknown |
| `0x453` | `00505720`  | unknown |
| ... | (many more game cmds) | |

## Login Response (HandleLoginResponse — `0050a590`, Login Server only)

### Result byte table
| Code | Meaning |
|------|---------|
| `0x03` | **Success** — parse server list, go to state 0x40 (server select UI) |
| `0x13` | **Success** — go directly to role select (state 4) — reads 3 empty entries |
| `0x1f` | Go to state 0x40 directly, no server list data needed |
| `0x1b` | Go to role select (reads 1 byte first) ← use for line-select reply |
| `0x01` | "Account error!" + disconnect |
| `0x0a` | "Account in use!" |
| `0x0c` | "Game version number error." |
| `0x11` | "Server is full!" |
| `0x20` | "Password error!" |
| default | "Password error!" |

### For result `0x03` (server list)
```
u16  cmd = 0x03e9
u8   result = 0x03
u8   field1, u8 field2, u32 field3   (unknown, send 0)
u8[8]  line-enable bytes             (first byte nonzero = line 1 enabled)
--- 3 server entries ---
Entry 0: u32 areaID (nonzero), u16 port, u8 status (nonzero), u16+str ip, u8, u8
Entry 1: u32 0x00000000  (skip)
Entry 2: u32 0x00000000  (skip)
u16 0x0000  (empty string)
u8  0x00    (flag)
```

## Line Selection Flow (confirmed live)
```
C→S: u16 cmd=0x044c, u8 subcmd=0x1c, u8 line_no
S→C: u16 cmd=0x03e9, u8 result=0x1b, u8 line_no
```
Moves client from server-select to role-select UI (state 4).

## Role Select Gate (`00478520`)
- Requires `byte [widget + 0x1d0] != 0` on at least one role widget slot
- Fires `005014a0(client+0x52744, slot_index)` → sends `cmd=0x044c/subcmd=0x0d/slot_index`

## `cmd=0x044c` — Character / Role Packets

### Client → Server
| Subcmd | Description |
|--------|-------------|
| `0x04` | Create role request |
| `0x0d` | Select role (enter game) — `u8 slot_index` |
| `0x1c` | Line selection — `u8 line_no` |

### Server → Client (`Handle044c` / `00504500`)
| Subcmd | Description |
|--------|-------------|
| `0x05` | Character create success |
| `0x06` | Character create failed |

## In-Game Aptitude Sync (CONFIRMED)

The create-selected aptitude is **not** finalized by the login/role packet path.

- Create request `0x044c / 0x04` carries:
  - `month`
  - `day`
  - `selectedAptitude`
  - `u16 extra1`
  - `u16 extra2`
- Role create success `0x044c / 0x05` does **not** populate the live in-game aptitude byte.
- The live Character Panel / "Strength Type" value is stored at:
  - `activeEntity + 0x650`
- That byte is written by `00441490`, which also copies the selected `zizhi` stat multipliers into:
  - `entity + 0x624 .. +0x634`

### Packet path
- Game packet `0x03f6`
- Internal subtype byte dispatched by `DispatchActiveEntitySubtypeUpdate03f6`
- Subtype `0x0a` calls the path that writes `entity + 0x650`

### Practical server behavior
- Persist `selectedAptitude` with the created character
- Carry it through the session-1 `0x0d` redirect into the game session
- After sending enter-game success on session 2, send a `0x03f6 / 0x0a` self-state packet with the selected aptitude byte

This is required for the in-game Character Panel to match the aptitude chosen during character creation.

## Position Persistence (CONFIRMED)

The client repeatedly sends game packet `0x03eb` with:

- `u16 x`
- `u16 y`
- `u16 mapId`

Practical server behavior:

- treat incoming `0x03eb` as the latest player position report
- persist `mapId/x/y` into `characters.json`
- carry that saved location through the session-1 `0x0d` redirect into the game session
- use the saved `mapId/x/y` in the next enter-game `0x03e9 / 0x03` packet instead of the fixed spawn

This is enough to keep the player at the last known location across relogs without implementing full movement simulation yet.

## Two-Connection Architecture (CONFIRMED)

The client makes **two separate TCP connections** to port 7777, each with its own handler table:

### Session 1 — Login Server
Uses the handler table at game object `+0x52a00` (`HandleLoginResponse` for `0x3e9`).
1. Server handshake
2. Client sends `0x3e9` login
3. Server → `0x3e9/0x03` server list response with one enabled entry
4. Client sends line select `0x044c/0x1c`
5. Server → `0x3e9/0x1b/line_no` → role select UI
6. Client sends role enter `0x044c/0x0d/slot`
7. Server → `0x3e9/0x0d` redirect packet (`ip`, `port`, `u16`, `u16`)
8. `HandleLoginResponse` case `0x0d` calls `ConnectGameServerSession` (`00413090`) on the second session object

### Session 2 — Game Server (new TCP connection)
Uses the handler table at game object `+0x52944` (`GameServerLoginResponse` for `0x3e9`).
1. Server handshake
2. Client sends `0x3e9` login
3. Server → `0x3e9/0x03` enter-game packet
4. `GameServerLoginResponse` → `ReadEntityFromPacket` → `LoadMapAndEnterGame` → `SetUiState(0x10)`

### Session Object Mapping (confirmed from assembly)
- `ConnectLoginServerSession` (`0040fb80`) uses session object `game + 0x52a00`
- `ConnectGameServerSession` (`00413090`) uses session object `game + 0x52944`
- Main loop `FUN_004157a0` calls `ConnectionStateMachine` on both objects every frame
- `HandleRoleSelectEnter` (`00478520`) only sends `0x044c/0x0d`; it does **not** reconnect by itself

## Redirect Packet (`HandleLoginResponse` case `0x0d`)

Confirmed format:
```
u16  cmd = 0x3e9
u8   result = 0x0d
u16+str  ip
u16  port
u16  unknown_1
u16  unknown_2
```

Practical use:
- this is the real login→game handoff
- sending `0x1f` and waiting for `onlineselect.lua` was the wrong path for entering game
- after sending `0x0d`, the next TCP connection is the one that must receive the enter-game `0x3e9/0x03`

## Enter Game Packet Format (`GameServerLoginResponse` case 0x03)

```
u16  cmd = 0x3e9
u8   result = 0x03
--- ReadEntityFromPacket (00436930) reads: ---
u32  area_id = 0               → entity+0x5b0
u16  entity_type = 0x3e9       → entity+0x40 (MUST pass LookupEntityTemplate!)
u32  unknown = 0               → entity+0x1dc
u16  spawn_x = 100             → entity+0x5b4
u16  spawn_y = 100             → entity+0x5b6
u16  discarded = 0
[vtable call using entity_type template]
u16+str  char_name             (length-prefixed, includes null terminator)
u8   extra_count = 0
--- caller (GameServerLoginResponse) reads: ---
u16  map_id = 101              (valid: 101–299 in map\mapset.ini [Main])
```

### ReadEntityFromPacket field order (byte offsets in entity struct):
- `FUN_00589270(entity + 0x5b0)` → reads u32 (area_id)
- `FUN_00589240(entity + 0x40)` → reads u16 (entity_type) — note: `int*` arithmetic, `param+0x10` = byte offset 0x40
- `FUN_00589270(entity + 0x1dc)` → reads u32
- `FUN_00589240(entity + 0x5b4)` → reads u16 (spawn_x) — `int*` `param+0x16d` = byte 0x5b4
- `FUN_00589240(entity + 0x5b6)` → reads u16 (spawn_y) — byte offset directly
- `FUN_00589240(local)` → reads u16 (discarded)
- `LookupEntityTemplate(entity_type)` → returns 0 if invalid → `ReadEntityFromPacket` returns 0 early!
- vtable call, read string name, read u8 extra_count

### Confirmed valid entity_type:
- `0x3e9` — hardcoded in game init (`00413ca0` calls `LookupEntityTemplate(0x3e9)`)
- In practice, class entity types are `0x3e9 + templateIndex`
- Live-confirmed:
  - create-role template index `0x14` → role entity type `0x3fd`
  - sending `entity_type=0x3fd` in the enter-game packet works and the in-game model matches the selected role
- Current working rule: use the role's saved `entity_type` in both role-select replay and enter-game

## Map Loading Chain (LoadMapAndEnterGame / `004113b0`)

```
LoadMapAndEnterGame(map_id, spawn_x, spawn_y):
  IniLoadFile("map\mapset.ini")
  key = sprintf("map%d", map_id)   // e.g. "map101"
  value = IniGetValue("Main", key) // e.g. "101" — alloc'd string
  if value == sentinel: return 0
  ok = LoadMapFiles(value, map_id)
  if ok:
    [SetUiState(0x10) path]
    return 1
  return 0
```

### LoadMapFiles (`0042e900`) — returns true only if ALL succeed:
```
SetCurrentDirectoryA(game_root)
cVar2 = MapDataLoad("map\{name}.map")   // via VFS or disk
cVar3 = MapCelLoad("{name}")            // loads unnamed cel format
cVar4 = MapEftLoad("map\{name}.eft")   // via VFS or disk
MapLitLoad("map\{id}.lit")             // unconditional
if DAT_00643288 == 0:
  MapMonLoad("map\{name}.mon")
return cVar4 && cVar3 && cVar2         // ALL three must succeed
```

### GCG Virtual Filesystem:
- Initialized at startup by `00413ca0` (reads `.\\gcg\\gcg.ini`)
- `DAT_0092139c = 1` after VFS is ready (set by `00589cc0`)
- `LoadFileVfsOrDisk` uses VFS when `DAT_0092139c != 0 && param3 != 0`; otherwise direct `fopen`
- GCG pack files: `gcg/map.gcg`, `gcg/ini.gcg`, etc. (15 files)
- `map.gcg` is 161,731 bytes — contains .map/.eft map data in a binary-encoded VFS format
- Map files (.map, .eft) are **NOT present on disk** — only in map.gcg VFS
- Map files (.cel, .lit, .b) ARE present on disk in `map/` directory

### map\mapset.ini [Main]:
- Valid map IDs: 101–299 (`map101=101` through `map299=299`)
- Current server can force a start scene via config; latest traced start scene is `map_id=207` (Cloud Hall)

### Status
- `LoadMapAndEnterGame` was **not** the blocker
- assembly confirms its success/fail branch was decompiled correctly
- `map.gcg` contains entries for `101.map`, `101.eft`, and `101.mon`
- the real problem was handler routing: enter-game `0x3e9/0x03` was being sent on the login session and handled by `HandleLoginResponse`
- after switching to the confirmed `0x0d` redirect handoff, the client successfully enters the game

## Current Server Behavior
- Immediate handshake with `seed=0`, `flags=0x44`
- Log cleared on start (`flags: 'w'`)
- **Session 1 (login):** `0x3e9` → reply `0x03` server list (with 127.0.0.1:7777 entry) → line select → role select
- Login packet username is parsed and used as the local account key
- Local role persistence stored in `characters.json`
- Ping `cmd=2` → pong `cmd=3`
- Line-select `0x044c/0x1c` → reply `0x03e9/0x1b/line_no` ✓ confirmed working
- Create role `0x044c/0x04` → reply `0x044c/0x05` (`entity_type = 0x3e9 + templateIndex`)
- Persisted role is replayed on role-select using the same `0x044c/0x05` packet path
- Enter game `0x044c/0x0d` on session 1 → reply `0x03e9/0x0d` redirect
- **Session 2 (game):** `0x3e9` login → reply `0x03e9/0x03` enter-game packet using saved `entity_type`, `map_id`, `x`, and `y`
- After enter-game, server sends `0x03f6 / 0x0a` to apply the saved aptitude to the live entity
- Incoming `0x03eb` updates refresh the saved `mapId/x/y` for the next relog
- Current dev config forces the start scene to Cloud Hall (`map_id=207`)
- Teleporter/scene changes now work via direct mid-session enter-game reloads, not via `0x0407`
- Static NPC spawns are now map-specific in server config (`STATIC_NPCS_BY_MAP`)

## Script Dispatch Findings (`0x03f1` / `0x0407`)

### Key functions
- `00532490` → `ScriptMacroServerRunScript`
- `004322b0` → `SendServerRunScriptRequest03f1`
- `0050bda0` → `HandleGamePacket03f1`
- `005084a0` → `HandleGamePacket0407`

### Confirmed behavior
- `macro_ServerRunScript(a, b)` in client Lua does **not** execute a local script directly.
- It calls `ScriptMacroServerRunScript`, which parses 2 numeric args and sends client→server packet `0x03f1`.
- Server→client `0x0407` is the actual local script executor for:
  - `script\\serverrun\\%d.lua`

### `0x0407` subtypes
- `'z'` (`0x7a`) → immediate `script\\serverrun\\%d.lua` execution from a `u16 scriptId`
- `'{'` (`0x7b`) → stores a `u16 scriptId` at `gameObj + 0x3cd6`, later executed by `FUN_00519ca0`

### Confirmed request layout for the visible Peach Garden click
- The Apollo-related UI click in Peach Garden currently sends:
  - `u16 cmd = 0x03f1`
  - `u8 subtype = 0x01`
  - `u16 scriptId = 1000`
  - `u16 mapId = 209`
- Live packet captured:
  - `f1 03 01 e8 03 d1 00`

### Important distinction
- Replying with `0x0407 / 'z' / 1000` is valid, but it only drives the generic onboarding/help text path.
- It does **not** run the Jade Emperor/Apollo Peach Garden film.
- Therefore `scriptId=1000` in `0x03f1/sub=0x01` is a request/action code, not the actual film script id.

### Script archive correlation
- The Peach Garden film block contains:
  - `macro_ClearNpcDemo()`
  - `macro_AddNpcDemo(1,3142,x,y,\"Jade Emperor\")`
  - `macro_AddNpcDemo(2,3054,117,127,\"Apollo\")`
  - film dialogue / camera movement
  - then `macro_ServerRunScript(2,20001)`
- That means `20001` is downstream from the film block, not evidence that `20001` starts the film.

### Current conclusion
- `macro_ServerRunScript(1,1000)` and `macro_ServerRunScript(2,1000)` are different branches.
- The currently visible Peach Garden click only triggers the `sub=0x01` help/onboarding branch.
- The Apollo intro film is likely behind the `0x03f1 / sub=0x02` family or another higher-context branch, not the already-mapped `sub=0x01` request.

## Test Credentials (from SETUP.INI)
- Username: `000000`
- Password: `123456` → MD5 = `E10ADC3949BA59ABBE56E057F20F883E`

## Tools
- **Packet capture proxy:** `capture.js` — listens on :7777, logs hex dumps
- **MCP:** Ghidra MCP via `.mcp.json` → `bridge_mcp_ghidra.py` → `http://127.0.0.1:8089/`

## Open Items
- [ ] First inbound/outbound in-game packets after world entry beyond `0x03eb` and `0x03f6`
- [ ] Purpose of `0x044f` in the login→role flow
- [ ] Full meanings of `0x044d` subcmds `0x27`, `0x28`, `0x33`
- [ ] Proper "existing role list" packet so persisted roles do not show the create-success popup
- [ ] Real Apollo transition from Peach Garden (`map 209`) to Rainbow Valley
- [ ] Exact request/response mapping for `0x03f1 / sub=0x02`, which is now the strongest lead for the Peach Garden Apollo film path
- [ ] Exact world-entity spawn/update fields needed to render named map NPCs beyond Scholar

## Heaven Map Progression
- Direct scene reload via the existing `0x03e9 / 0x03` enter-game packet works mid-session for Heaven-side transitions
- Confirmed map ids from live tests:
  - `204` = `Celestial State`
  - `206` = `South Gate`
  - `207` = `Cloud Hall`
  - `208` = `Covert Palace`
  - `209` = `Peach Garden`
- The Peach Garden standing teleporter request is:
  - client -> server `0x03f1 / sub=0x01 / script=1 / map=209`
- That request is **not** satisfied by:
  - `0x03f1` message reply
  - `0x0407 / 'z' / 1`
  - `0x0407 / '{' / 1`
- The currently working server-side approach is to treat that request as a scene transition trigger and send a direct enter-scene reload instead
- Current dev start scene is pinned to `207` (Cloud Hall)

## Peach Garden Trace
- `136` was a false lead: `macro_ChangeScene(136,44,311)` is the Rainbow Valley quest jump into Bling Alley 1, not Peach Garden
- Quest/help-layer map numbers are not always interchangeable with the enter-game map flow; `210` resolved to West County Pass in practice
- Peach Garden was pinned through NPC cross-reference, not scene-change guessing:
  - Peach Garden setup block contains NPCs `3142`, `3144`, `3136`, `3326`, `3413`, `3751`, etc.
  - quest/help text ties NPC `3142` to `macro_GetMapName(209)`
  - same Peach Garden block places `3142` at `115,98`
- The Peach Garden teleporter trigger currently emits:
  - `0x03f1 / sub=0x01 / script=1 / map=209`
- Live scene tests from that trigger established the Heaven-side ids:
  - `206` = South Gate
  - `208` = Covert Palace
- Current forced start no longer uses Peach Garden; it now uses confirmed Cloud Hall `map 207`
- Ghidra follow-up on `macro_GetMapName`:
  - script macro bridge is `FUN_00532500`
  - it resolves the current map id from `DAT_008ed358`
  - name lookup goes through `FUN_00547bb0` -> `FUN_0042bfc0`, which walks the runtime map-info tree
  - practical implication: map names are not exposed as a simple hardcoded switch/string table in `gc12.exe`; recovering more names will likely require tracing the loaded map metadata path, not just scanning strings

## NPC Rendering Findings
- `macro_AddMapNpc(npcId, npcTypeFlags, name, x, y)` populates map/UI/script metadata, not necessarily a directly renderable world entity
- The second argument is a bitmask/category (`PLAYER=1`, `SELL=2`, `TASK=4`, `OTHER=8`), not a world `entity_type`
- `ScriptMacroSetClientNpcType` writes a client-side override to `entity + 0x5d8`
- `ApplyClientNpcTypeAndRefreshAppearance` rebuilds visuals from that override
- `0x03eb / 0x15` dispatches into `ParseEntitySpawnFrom03eb`, which has both short and extended entity forms
- Scholar is still the only live-confirmed static NPC render from the spoofed spawn path
- Replaying Peach Garden's full `macro_AddMapNpc` list on the server did **not** produce visible NPCs in-world
- Current conclusion: map-NPC ids and coordinates are correct, but named NPCs still need either:
  - the richer `0x03eb` entity record that drives the `+0x5d8` appearance path, or
  - a separate client-side `npc_id -> clientNpcType` mapping step before they can render
- Apollo in Peach Garden is not yet proven to be a normal free-roam world spawn:
  - `macro_AddNpcDemo(2,3054,117,127,\"Apollo\")` shows Apollo is spawned client-side inside a film/demo block
  - direct `0x03eb` world-spawn attempts with `entity_type=3054` did not show Apollo

## Resolved Highlights
- Login packet payload is `0x3e9 + username + MD5 + 'S'`
- Packet layer is XOR-only; AES exports in `Login.dll` are not used for transport
- Server handshake is `cmd=1 + uint32 seed`, with `flags=0x44`
- Session 1 is the login server and session 2 is the game server on the same TCP port
- Real login→game handoff is `0x03e9 / 0x0d`, not `0x1f`
- Line selection is `0x044c / 0x1c` → `0x03e9 / 0x1b`
- Enter-game success is `0x03e9 / 0x03` on session 2
- Role widgets are currently populated by replaying `0x044c / 0x05`
- In-game class entity mapping is `0x3e9 + templateIndex`
- Live aptitude is applied by `0x03f6 / 0x0a`
- Position persistence is driven by client `0x03eb` updates
- `LoadMapAndEnterGame` and the GCG VFS were verified and are not the current blocker
- Peach Garden is confirmed as `map 209`; `136` is Bling Alley 1 and `210` is West County Pass in the live flow
