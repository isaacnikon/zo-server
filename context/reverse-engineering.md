# Reverse Engineering Notes

## Client Files
- Game root: `/home/nikon/Data/Zodiac Online/`
- Main executable: `gc12.exe`
- Login DLL: `Login.dll`

## Ghidra
- Project: `/home/nikon/ghidra/ZO.gpr`
- Loaded program: `gc12.exe`
- MCP config: `.mcp.json`
- HTTP endpoint: `http://127.0.0.1:8089/`

## Safely Renamed Functions
- `RegisterPacketHandlers` at `0x00514c00`
- `HandleLoginResponse` at `0x0050a590`
- `GameServerLoginResponse` at `0x0050a200`
- `Handle044c` at `0x00504500`
- `HandleGamePacket03f1` at `0x0050bda0`
- `HandleGamePacket0407` at `0x005084a0`
- `LoadMapAndEnterGame` at `0x004113b0`
- `LoadMapFiles` at `0x0042e900`
- `MapDataLoad` at `0x0042e0b0`
- `MapCelLoad` at `0x00422630`
- `ReadEntityFromPacket` at `0x00436930`
- `LookupEntityTemplate` at `0x00444790`
- `GetGameObject` at `0x0040f200`
- `GetActiveEntity` at `0x0040f1f0`
- `VfsLookupFile` at `0x00560a60`
- `LoadFileVfsOrDisk` at `0x0058a170`
- `IniGetValue` at `0x0058a4c0`
- `IniLoadFile` at `0x0058a790`
- `ScriptMacroServerRunScript03f1` at `0x00532490`
- `SerializeServerRunRequest03f1` at `0x004322b0`

## Map Name Resolution
- `macro_GetMapName` bridge is `FUN_00532500`
- It resolves current map id from `DAT_008ed358`
- Name lookup goes through:
  - `FUN_00547bb0`
  - `FUN_0042bfc0`
- That walks a runtime map-info tree, so map names are not exposed as one simple static switch/string table

## Tile/Scene Data
- `MapCelLoad` loads 6-byte per-cell scene records from map data
- Record shape is effectively:

```c
struct MapCellSceneRecord {
  uint16_t flags;
  uint16_t scene_id;
  uint16_t aux_value;
};
```

- Useful helpers:
  - `FUN_00422250(x, y)` -> scene id
  - `FUN_004222a0(x, y)` -> aux value
  - `FUN_00422200(x, y, mask)` -> flag test

Important limitation:
- tile scene metadata gives trigger identity, not destination

## Script Extraction Findings
- `extract-scene-travel.js` can recover some `RoleCheckRound -> macro_ChangeScene` pairs from `script.gcg`
- It works well for maps like `Bling Spring`
- It does not recover every map automatically
- `Bling Alley` is one example where local scene-change scripting is not exposed in the same simple pattern

## Working Rule
- Use client scripts and live `0x03f1` requests together
- Do not assume every travel route is discoverable from `.b` data alone
