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
- `HandleGamePacket03ec` at `0x00504800`
- `HandleGamePacket03ed` at `0x00504820`
- `HandleGamePacket03ee` at `0x0050ba70`
- `HandleGamePacket03fa` at `0x00504b70`
- `HandleGamePacket03f0` at `0x005052a0`
- `HandleGamePacket0406` at `0x00505280`
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
- `DispatchFightStream03fa` at `0x0051f5e0`
- `EnterFightMode` at `0x00518a10`

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

## Combat RE Notes
- `0x03fa` is the main combat stream dispatcher. `HandleGamePacket03fa` just stores the packet cursor and calls `DispatchFightStream03fa`.
- `0x03fa / 0x65` is the combat-enter path. The dispatcher queues the packet and then calls `EnterFightMode`.
- `0x03fa / 0x66` is not adjacent to `0x65` in the jump table. It dispatches to `0x00520f3e`, not the `0x65` branch at `0x005222ea`.
- `0x03fa / 0x34` leads to `FIGHTCONTROL` visibility/update behavior.
- `0x03fa / 0x34` case mapping is now explicit:
  switch subcommand `0x34` goes to `0x00521e1f`, parses a single `u32` entity id, looks up the fight entity through `FUN_00515cf0`, and opens `FIGHTCONTROL` only when that entity matches the current active entity.
- `0x03fa / 0x02` now looks like the stronger action-wheel bootstrap candidate:
  it maps to `0x0052289c`, reads no packet body, clears fight-control state, and runs the embedded macro string
  `macro_GuiSetWinVisable("FIGHTCONTROL", 1) macro_GuiSetWinOpenClose("NPCKICK") ...`
  before resetting several per-entity control flags.
- `0x03fa / 0x03` is now the next startup-adjacent candidate after `0x02`:
  it maps to `0x00522d3b`, reads `u32 entity_id` and `u8 enabled_flag`, conditionally loads one of the two `DAT_008e90e8/..ec/..f0` or `DAT_008e90f4/..f8/..fc` state triplets, then ends by calling `FUN_00516750(slot_index, enabled_flag)`.
- `FUN_00516750` is not UI-only bookkeeping:
  it converts a slot index into the 3x5 fight board and calls `FUN_005166e0`, which writes board-slot mode `6` for enabled and `7` for disabled.
  This is the first confirmed startup-adjacent branch that directly changes active combat-slot state.
- `0x03fa / 0x0a` is the next compact startup-adjacent state packet:
  it loops until payload end, reading repeated `u32 entity_id, u32 state_4c, u32 hp_like, u32 mp_like` rows.
  For each resolved combatant, it writes `+0x4c`, `+0x20c`, and `+0x210`, then rescans both 3x5 board halves and repairs per-slot state.
  This makes `0x0a` a plausible missing companion to `0x65` because it seeds per-fighter runtime state instead of just UI flags.
- Live test result after adding `0x0a`:
  the client no longer stays completely inert. It now plays a default combat animation and sends its first inbound combat packet in the synthetic flow: `0x03ed` with a single body byte `0x09`.
  That strongly suggests the startup path is now partially valid and the remaining missing piece is the command-wheel/command-list population layer.
- `0x03fa / 0x33` maps to `0x00521e94` and also parses a single `u32` entity id.
- `0x03fa / 0x68` maps to `0x00522a9d` and parses a single `u32` entity id, then marks the looked-up entity's `+0x83` byte.
- `0x03fa / 0x67` maps to `0x005211c0` and is a structured control-state packet, not a single-entity-id flag packet.
- `0x03f0` is processed as fight turn/round data, not initial encounter creation.
- `0x0406` is not encounter start. It routes into a look/inspect-style path and can open `LOOKWIN`.
- Current server finding:
  The synthetic `0x03fa / 0x65` packet was entering combat mode but triggering `Combat data error!` because the server omitted the per-entry `side` byte that the parser expects before each combatant record.
- Additional `0x03fa / 0x65` finding:
  The per-combatant `name` is parsed through `FUN_005892a0`, which rejects zero-length strings. The transmitted name field must be length-prefixed and include a trailing NUL byte.
- Placement observation from live testing:
  In the current synthetic encounter, `side=1` and `side=0xff` were reversed relative to the expected player/enemy battlefield positions. Flipping the active player to `0xff` and the enemy to `1` corrected the layout.
- Turn packet finding:
  `0x03f0` is parsed by `FUN_0054ce10` as `u8 mode`, then for `mode == 0` a `u16 count` followed by `count` entries of three `u16` fields. The server's current placeholder turn packet is not semantically understood yet and is a likely cause of the non-interactive fight UI.
- `0x03f0` action-factory detail:
  `0x03f0` is not a `DispatchFightStream03fa` subcase; it has its own handler path:
  `HandleGamePacket03f0 -> FUN_00431a40 -> FUN_0054ce10 -> FUN_0054cd70`.
- Corrected row-field meaning:
  Each `(u16, u16, u16)` row is passed into `FUN_0054cd70(field_a, field_b, field_c)`.
  `field_a` is resolved through `FUN_00502500`, and the returned action-definition record determines which action class is created via `record + 0x0c -> FUN_0054d800`.
- Confirmed row-field behavior:
  `field_b` is passed to the action object's virtual setup method at `[vtable + 0x2c]` together with the fight manager context.
  `field_c` is written into the action object by `FUN_0054afa0` and then copied into cached fields by `FUN_0054a660`.
- Setup-method detail:
  the common `+0x2c` implementation (`FUN_0054ba40`) stores `field_b` as a byte and immediately rebuilds a cached `0x26`-entry parameter table by calling `FUN_0054d190(field_b, stat_index)` for `stat_index=0..0x25`.
  This makes `field_b` behave like a zero-based level/index into the looked-up action record rather than an action class or menu id.
- Deduplication detail:
  `FUN_0054cd20` indexes already-created actions by `record + 0x12`, which is likely the stable command id or menu-slot id associated with the action-definition record rather than a raw packet field.
- Confirmed action classes created by `FUN_0054d800` are keyed by ids `1, 2, 3, 5, 6, 8`.
- Lookup-tree initialization:
  `DAT_008ee7bc` is not static packet metadata. `InitializeGameDataAndVfs` allocates and initializes it through `FUN_0054de80`, then `FUN_0054dee0` populates it from `attrres\\Skill\\magic.txt`.
  `FUN_00502500(key)` is just the tree lookup helper that returns the value pointer for integer key `key`.
- Loader detail:
  `FUN_0054db70` parses one action definition at a time, then inserts it into the lookup tree keyed by the parsed `u16` at record `+0x38`.
  The same record's `+0x0c` selects the runtime action class via `FUN_0054d800`.
- Concrete built-in ids:
  the `FIGHTCONTROL.skill` handler (`FUN_0047af60`) explicitly calls `FUN_00502500` for `0x1389..0x138e` and adds those loaded records into the fight skill UI when the active entity supports them.
  Decimal ids:
  - `0x1389` = `5001`
  - `0x138a` = `5002`
  - `0x138b` = `5003`
  - `0x138c` = `5004`
  - `0x138d` = `5005`
  - `0x138e` = `5006`
- Important correction:
  `UI_DEF/config/751.cfg` still exposes ids `100..107`, but current RE shows those are UI/config-layer ids, not the direct runtime lookup space for `0x03f0.field_a`.
- Action-class clue:
  class-1 validation (`ActionVfunc_54a850`) explicitly special-cases ids in ranges `5001..5006` and `8050..8169`, which further supports that `0x03f0.field_a` should be in the loaded skill-id domain rather than the `100..107` UI-config domain.
- `0x69..0x6c` classification:
  these later high subcommands are not startup control.
  `0x69` is a two-entity action/result path, `0x6a` is a tip popup, `0x6b` is perfect-kill/score text, and `0x6c` is a pet/join-combat style structured status path.
- Low-numbered result/state branches that are not good startup shortcuts:
  `0x07` (`0x0051f985`) is a large action-result/status path with an action lookup, per-entity updates, and battle text generation.
  `0x05` (`0x005201a3`) is another structured action/result path keyed by an action id from `DAT_008ee7bc`.
  `0x06` (`0x00522efd`) is a larger two-entity interaction/status path, not a compact startup-control packet.
- Current server-side test plan:
  keep the multi-row `0x03f0` profiles that use built-in action ids `5001..5006`, keep the bare `0x03fa / 0x02` after `0x65`, keep the minimal `0x03fa / 0x03` probe for the active entity, and now add a minimal two-row `0x03fa / 0x0a` state-sync for the active player and synthetic enemy.
  current profiles:
  - all six ids with `field_b=0`, `field_c=0`
  - all six ids with `field_b=1`, `field_c=0`
  - all six ids with `field_b=0`, `field_c=1`
  the current profile cursor remains persisted in `combat-probe-state.json`, so restarting the server advances to the next profile.
- Next RE target:
  trace how `FIGHTCONTROL` populates the top-level battle wheel (`Attack/Defend/Skill/Run/Pet...`) instead of assuming `0x03f0` alone is that mechanism.
- `FIGHTCONTROL.skill` separation:
  `FUN_0047af60` only builds the skill submenu. It adds available entries through repeated `FUN_004c94e0(...)` calls and includes built-in action ids `5001..5006`, but only after fight state is already active.
  It does not create the top-level combat ring itself.
- `macro_SendGoMyRound` is not the missing ring trigger:
  the macro resolves to `FUN_0052d5b0`, which is effectively a stub returning `0`.
- `macro_ExecAction` is a stronger top-level ring anchor:
  the macro resolves to `FUN_005266a0`, which calls `FUN_004560b0(menu_id)` and then `FUN_00456c90(menu_id)`.
  Confirmed `FUN_00456c90` cases:
  - `1` sets `GetGameObject()->3bbc = 1` when in fight
  - `2` calls `FUN_0051b030(1)` when in fight
  - `9` sets `GetGameObject()->3bbc = 9` when in fight
  - `10` builds the summon submenu and opens `FIGHTCONTROL.summer`
  - `0xb` calls `FUN_0051bb50()`
- `macro_PushFightAction` is staging logic, not a direct ring renderer:
  `ScriptMacroPushFightAction` at `0x00529600` parses 9 args, initializes 15 entries, calls `FUN_00514ef0`, `FUN_0051f170`, then clears a temp vector with `FUN_00471360`.
  `FUN_0051f170` copies those staged rows into a freshly allocated object from `FUN_0051ec20(...)`.
  This looks like action-data staging or queueing, but not the final outer ring paint step by itself.
- `macro_SetFightAttack`, `macro_SetFightAttackDef`, and `macro_SetFightRunAway` are not top-level ring creators:
  they set per-slot attack/target/protect state after the client is already in a fight-command flow.
- Stronger command-mode model:
  the top-level combat wheel is now best modeled as a client state machine around `GetGameObject()->3bbc`.
  Multiple fight helpers clear pending state, call `FUN_00519a20()`, and when it returns `0` they set `3bbc = 1`.
  That makes `3bbc = 1` the strongest confirmed "show command selection" state so far.
- Fight-control helper cluster:
  the helpers around `0x0051acd0..0x0051bb50` stage the concrete command state used by the ring flow.
  Confirmed examples:
  - `FUN_0051acd0` stages an attack-style target selection from a board index
  - `FUN_0051b030` stages a no-target command and can move into `3bbc = 1`
  - `FUN_0051b2b0` stages a command with `(target_entity, extra_value)`
  - `FUN_0051b540` stages a capture-style target command
  - `FUN_0051b660` stages a `(target_entity, skill_or_slot)` command
  - `FUN_0051b8d0` stages a simple entity-targeted command
  - `FUN_0051b990` stages a protect/guard-style command
- `FUN_00519a20` role:
  it is a validator / queue-state gate for the fight command UI.
  It returns `0` in the "stay in selection/UI state" cases and `1` when the current pending-selection bookkeeping can be collapsed and the queue entry can be freed.
  This is why the helpers set `3bbc = 1` specifically when `FUN_00519a20() == 0`.
- Live implication:
  the synthetic startup now gets far enough to trigger an inbound `0x03ed / 0x09`, but current RE still has not found an incoming packet branch that directly drives the client into the same `3bbc = 1` pending-command state used by real command selection.
  That makes `0x03ed / 0x09` a stronger next RE target than another blind `0x03f0` tweak.
  The server harness now defers its synthetic `0x03f0` action-table send until the client emits `0x03ed / 0x09`, so the next live test can validate whether that packet is the readiness gate for command selection.
  Live result after that change: the client accepts the delayed `0x03f0` but still does not show the ring and instead displays `Combat: Summon pet failed!`. Combined with `FUN_00456c90(10)` being the summon submenu path, this makes the current `5001..5006` action profile look much more like summon-family actions than the top-level attack/defend/run ring.
- `DispatchFightStream03fa` switch-table correction:
  the `0x63..0x69` subcommand range had been shifted by one case in earlier notes.
  Reconstructing the table at `0x00523498` / `0x00523524` gives the corrected mapping:
  - `0x63 -> 0x005222ea`
  - `0x64 -> 0x00520f3e`
  - `0x65 -> 0x005211c0`
  - `0x66 -> 0x00522a9d`
  - `0x67 -> 0x00522ae2`
  - `0x68 -> 0x005216a5`
  - `0x69 -> 0x00521afc`
  - `0x6a -> 0x005216bb`
  - `0x6b -> 0x00521aeb`
  - `0x6c -> 0x0052168f`
  This means the earlier “`0x65` is fight entry” conclusion was wrong; the row-based fight-entry parser is actually `0x63 -> 0x005222ea`.
- `0x03fa / 0x0a` correction:
  the branch at `0x0052125a` is not a generic board stat-sync path.
  It parses summon-related state and can emit the messages:
  - `Your pet is not healthy enough to enter fight!`
  - `Your pet level is too high to enter Fight!`
  - `%s Joined the Combat!`
  - `Start to summon pet!`
  - `Summon pet failed!`
  So the synthetic startup packet previously sent as `0x0a` was misclassified and was steering the client into a summon/pet flow.
- Live contradiction to resolve:
  despite the corrected switch-table reconstruction, replacing the synthetic entry packet with `0x03fa / 0x63` caused the client to ignore combat startup entirely.
  Restoring `0x03fa / 0x65` immediately brought back the last known-good live entry trigger.
  So either:
  - `0x63` is not sufficient on its own and depends on another nearby startup packet/state, or
  - the current `0x63..0x69` mapping still needs one more verification pass against the raw branch addresses.
- `0x03fa / 0x64` branch shape:
  the branch at `0x00520f3e` is a compact control-state update:
  - it sets `byte [fightMgr + 0x29e6] = 1`
  - it sets `dword [fightMgr + 0x3cb4] = 1`
  - it reads three mandatory `u32`s
  - it only reads a fourth `u32` when the third field is `> 0`
  - it can also refresh cached globals when the third field is `-1`
  - it stores the parsed values into fight-manager fields around `+0x2c08`, `+0x2c0c`, `+0x2c20`, and can append a trailing list into the vector at `+0x2c28`
  Compared with `0x65`, which lands in mode/state `2`, this makes `0x64` the strongest remaining candidate for “command-selection mode” setup.
- Live click-handler clue:
  during the synthetic fight, double-clicking the enemy now reaches the client-side order path and produces:
  `You are not in battle. You can not give orders!`
  That string comes from the fight command helpers such as `FUN_0051acd0` / `FUN_0051b030`.
  So the client is not merely missing the outer ring; its own order helper still fails the internal "in battle / active combatant registered" check when invoked from the fight scene.
- `0x03fa / 0x01` branch:
  the branch at `0x0052289c` is the first incoming fight-stream path that directly matches the ring-open state model:
  - it looks up the active entity in the fight table with `FUN_00515cf0(activeEntity->5b0)`
  - it executes the `FIGHTCONTROL` macro/open path
  - it explicitly sets `GetGameObject()->0x3bbc = 1`
  - it toggles additional fight UI state such as `0x00627ee8`
  This makes `0x01` a stronger ring-open candidate than `0x02` or `0x64`.
- Active-fighter lookup detail:
### 2026-03-16 Live Breakpoint Findings For `Combat data error!`

- Debug target: `/home/nikon/Data/Zodiac Online/gc12.exe`
- Located popup string:
  - `"Combat data error!"` at `0x005d508c`
- `gdb` watchpoint on the string first broke in helper `0x004cacb7`
- Combat-adjacent xrefs then led to breakpoints at:
  - `0x005221ad`
  - `0x00522809`
- Live breakpoint hit:
  - `0x00522809`
- Failure branch near the hit:
  - `0x005227db` prepares dialog args
  - `0x00522802` calls `0x004c9c70`
  - `0x00522809` calls `0x004cac10`
- Success branch immediately above:
  - `0x005227ca..0x005227d4` pushes three signed bytes and constants, then calls `0x00519bf0`
- Live disassembly of `0x00519bf0` showed:
  - arg1 (`edx`) must satisfy `0 <= arg1 < 3`
  - arg3 (`ecx`) must satisfy `0 <= arg3 < 5`
  - arg2 selects side handling (`1` vs `-1`)
  - on success writes:
    - `+0x5bc = row`
    - `+0x5bd = col`
    - `+0x5be = side flag`
- Stack-derived values at the popup breakpoint for the broken multi-enemy startup decoded as:
  - `row = 2`
  - `col = 3`
  - `side = 0x78`
- `0x78` is decimal `120`, exactly matching the synthetic enemy HP value. This proved the per-fighter parse was shifted and not merely using a bad slot or template id.
- Tracing earlier in the parser from `0x005223d0` showed the row decode structure:
  - read base fields for every fighter row
  - if the row is the active player, consume an extended tail:
    - extra short values
    - extra byte values
    - trailing name-related block
  - non-player rows do not consume that same tail before placement validation
- Practical RE conclusion:
  - the local `0x03fa / 0x65` harness must not serialize the extended row tail for enemies
  - the previous single-enemy success had masked this because the bad tail was at packet end
  - adding a second enemy exposed it by shifting the next row so HP landed in the side byte
  `FUN_00515cf0` scans the fight table for an entry whose pointed fighter object's `+0x5b0` matches the queried id.
  The latest live behavior strongly suggests the active player's runtime `+0x5b0` is not matching the `entityId` we serialize in the synthetic fight rows.
  Since the current server writes `this.entityType` into that `entityId` field, the most likely remaining bug is that we are using a template/type identifier where the client expects the active combatant's runtime identity.
- `ReadEntityFromPacket` at `0x00436930` makes the enter-game layout concrete:
  - `FUN_00589270` reads a `u32` into `activeEntity + 0x5b0`
  - `FUN_00589240` reads `u16` fields into `+0x40`, `+0x5b4`, and `+0x5b6`
  - another `FUN_00589270` reads a `u32` into `+0x1dc`
  - `FUN_005892a0` reads a length-prefixed string for the entity name
  - `FUN_00589210` reads a trailing `u8` into `+0xd64`
  - if that byte is positive, a second length-prefixed string is copied into `+0xd48`
- Live memory had `GetGameObject()->activeEntity->0x5b0 == 0` while the active-id global at `0x008e90e4` already held `0x3fd`.
  That points back to the enter-game/login packet rather than the later fight stream.
- The server's `sendEnterGameOk()` had been sending `u32 0` in the first `ReadEntityFromPacket` slot.
  That field is now patched to send `this.entityType`, which should seed the local player's runtime id before any fight-command lookup depends on `activeEntity->0x5b0`.
- Private server dump at `/home/nikon/Downloads/shengxiao/Server/attrres/` adds useful external corroboration:
  - `fight/fightPosition.txt` lines up with the inferred two-side battlefield slot model.
  - `skill/magic.txt` confirms the runtime skill/action records live in the same data family the client lookup tree references.
  - `fightinfo.txt` appears to be a separate fight-command table and includes at least command id `101`, which is a better fit for the top-level combat ring than the `5001..5006` skill ids previously used in synthetic `0x03f0`.
- Local server follow-up:
  `src/combat-reference.js` now parses the private dump directly and exposes:
  - reference fight-command ids from `fightinfo.txt`
  - reference skill ids from `skill/magic.txt`
  - reference battlefield side-position rows from `fight/fightPosition.txt`
  `src/session.js` now builds its synthetic `0x03f0` profiles from the reference skill ids instead of the previous hardcoded built-in summon ids.
- Private server binary `gc_server.exe` is now imported in Ghidra and gives the first concrete server-side combat packet map:
  - registration routine `0x00412100` binds `0x03ed` to `0x00427630` and `0x03ee` to `0x00427690`
  - `0x00427630` forwards into the real action parser `0x00463130`
- `0x00463130` confirms the client's attack-click packet semantics:
  - `sub=0x03` reads three `u8` values into the acting fighter object at `+0x3e2/+0x3e3/+0x3e4`
  - then it calls `0x00430380(fight_list)`
  - this matches the live packet `ed 03 03 01 01 02`
- `0x00430380` advances the fight-list state machine and calls `0x0043ae30`, which is the main resolution routine for fighter actions.
- `0x0043ae30` consumes the acting fighter's action mode at `fighter + 0x3e1`.
  In its mode/case `0x03` branch it resolves the attack-style action using the stored bytes at `+0x3e2/+0x3e3/+0x3e4`.
- The original server helper `0x004316c0` seeds a default attack by setting:
  - `fighter + 0x3e1 = 0x03`
  - `fighter + 0x3e2 = 0x01`
  - target bytes into `fighter + 0x3e3` and `fighter + 0x3e4`
  That is the clearest confirmation so far that action mode `3` is the normal attack path in server-side combat resolution.
- Local implementation step:
  `src/session.js` now consumes inbound `0x03ed / 0x03` as a synthetic normal-attack selection.
  It does not yet reproduce the original server's full fight-list execution, but it now:
  - parses the three action bytes
  - resolves them against the synthetic enemy slot
  - decrements synthetic enemy HP
  - sends a minimal `0x03fa / 0x66` result/state update before the follow-up `0x03f0`
  so the attack click is no longer answered only by a turn-table refresh
- Ring-population anchors:
  the client registers explicit fight-control callbacks such as `OnRunAway`, and the binary also contains macro strings `macro_SetFightAttack` and `macro_SetFightAttackDef`.
  Those are stronger anchors for the top-level attack/defend/skill/run ring than `0x03f0` alone.
- `0x03fa / 0x66` parser finding:
  the client reads at least four `u32` values into `DAT_008e90e8/..ec/..f0/..f4`, optionally two more `u32` values when `DAT_008e90f4 != -100000`, then three more `u32` fields that are copied into the fight manager at `+0x2c08/+0x2c0c/+0x2c20`, then conditionally a fourth `u32`, then a trailing `u32` list stored at `+0x2c28`.
- `0x03fa / 0x67` parser finding:
  the client reads the same leading state globals `DAT_008e90e8/..ec/..f0/..f4`, and when `DAT_008e90f4 != -100000` it also reads `DAT_008e90f8/..fc`.
  It then sets fight-manager flags `+0x29e6 = 1` and `+0x3cb4 = 2`.
  This makes `0x67` a better candidate than `0x66` for a minimal combat-control companion packet during startup experiments.
- Practical implication:
  a minimal synthetic `0x66` packet is structurally invalid for this branch, so it should not be used as the current combat-start probe path.
- Live test correction:
  sending that minimal `0x67` immediately after `0x65` caused the client to enter combat and then exit immediately, so `0x67` is not a valid startup companion for the current synthetic encounter shape.
- Current server-side follow-up:
  remove `0x67` from the startup probe sequence and continue focusing on the remaining control-state packets around `0x69..0x6c` and the turn/action lifecycle.
- State effect detail:
  the `0x66` branch sets fight-manager flags `+0x29e6 = 1` and `+0x3cb4 = 1`, and if an active target exists it copies cached values into target fields `+0x20c`, `+0x210`, `+0x288`, and sometimes `+0x264`.
- Original server send-path detail:
  `gc_server.exe` `FUN_00434b90` serializes a post-action `0x03fa` packet with subcommand byte `param_4`; one live caller path uses `'f'` (`0x66`).
  The payload begins with:
  - three `u32` actor state fields from `FUN_004166d0(..., 0xb/0xc/0xd)`
  - a companion block or the sentinel `-100000`
  - then compact action/result fields
  This is the strongest current anchor for post-attack client-visible updates.
- Follow-up caller detail:
  `FUN_00435880` does not stop after `'f'` (`0x66`).
  After the first pass it rewrites the subcommand char to `'g'` (`0x67`) and broadcasts the paired update across the opposite board side.
  So a lone synthetic `0x66` is incomplete relative to the original server's post-attack flow.
- Normal-attack playback detail:
  in `FUN_0043ae30` case `3`, the original server writes through `DAT_0053a418`:
  - `u16 0x03fa`
  - `u8 0x03`
  - `u32 attacker_runtime_id` from `attacker + 0x3b0`
  - `u32 target_runtime_id` from `target + 0x3b0`
  - then the target helper `FUN_00453ab0(...)` appends the one-target hit body:
    - `u8 result_code`
    - `u32 damage`
    and for split hits may append extra `(target_id, result_code, damage)` fields
  That makes `0x03fa / 0x03` the strongest current candidate for the actual hit/playback packet, with `0x66/0x67` acting as aftermath/state sync rather than the primary animation trigger.
- Local harness change:
  `src/session.js` now emits:
  - experimental `0x03fa / 0x03` playback packet with `(attacker_id, target_id, result_code, damage)`
  - `0x03fa / 0x66` synthetic result update
  - `0x03fa / 0x67` synthetic mirror update
  before the next `0x03f0` turn refresh.
- Multi-target playback experiment result:
  appending extra target tuples to `0x03fa / 0x03` was wrong. The client interpreted them as a real defend/secondary-target interaction, and the fight could terminate incorrectly.
  The local harness is reverted to a single explicit target in the playback packet.
  Practical implication: the missing multi-target data is not harmless post-hit padding; it is more likely part of the pre-attack target-selection state or the original server's target-processing helpers before playback.
- Synthetic encounter expansion:
  the local fight harness now seeds a multi-enemy formation rather than a single target.
  The current isolation build uses 2 enemies on row `0` with columns `1/3`, matching common two-monster spreads in the private `scenefight/*.lua` scripts such as `46.lua`, `48.lua`, and `42.lua`.
  Attack-selection handling no longer assumes a single hardcoded beetle; it resolves the incoming target bytes against the live enemy array and applies playback/state updates to the matched runtime id.
- Multi-enemy startup isolation step:
  `src/session.js` now uses a reduced startup sequence for multi-enemy synthetic fights:
  - keep `0x03fa / 0x01`
  - keep `0x03fa / 0x34`
  - skip `0x03fa / 0x64`, `0x02`, `0x03`, and `0x33`
  This is an isolation patch, not a final protocol conclusion. The fight already enters and the wheel appears with multiple enemies, so the goal is to determine whether the popup comes from the extra startup probes rather than the multi-entry `0x65` body itself.
- Harness correction:
  the local `0x03f0` probe rotation is now locked per synthetic encounter.
  The server still advances the persisted probe cursor across separate fight restarts, but it no longer changes `0x03f0` profiles between the readiness handshake and later in-fight refreshes.
  This removes a self-inflicted mismatch where one fight could receive two different command tables after the first attack.
- Additional harness correction:
  the local server no longer sends an `attack-selected` `0x03f0` refresh while the initial readiness handshake (`0x03ed / 0x09`) is still pending.
  Live logs showed the client could select and attack a target before the first readiness packet arrived, which caused the harness to send:
  - one `0x03f0` after the attack
  - then a second `0x03f0` when the delayed `0x03ed / 0x09` finally arrived
  That duplicate turn-table ordering is now suppressed.
- Multi-enemy aftermath isolation:
  the local server now treats a non-lethal hit in a synthetic multi-enemy fight as:
  - `0x03fa / 0x03` playback
  - follow-up `0x03f0`
  while still skipping `0x66` and `0x67`
  and clearing the stale startup-handshake state.
  This is not a claim about the original protocol. It is a targeted isolation step to determine whether the current multi-target exit/popup is caused by the post-hit synchronization packets rather than by the base attack playback packet.
- Live result:
  with `0x66/0x67` suppressed, the client still sends `0x03ed / 0x09` after the hit.
  That means `0x09` is also part of the post-action continuation path, not only the initial startup handshake.
  The local harness now answers later `0x03ed / 0x09` packets with a repeat command refresh:
  - `0x03fa / 0x01`
  - `0x03fa / 0x34`
  - `0x03f0`
  once the startup handshake has already been completed.
  Duplicate `0x03ed / 0x09` packets are now ignored by fight state once commands are already open and the server is waiting for the player's next action, because those repeats were making the wheel appear to reopen redundantly even though the queue logic itself was correct.
- Local server-state alignment:
  `src/session.js` now maintains a structured synthetic fight state that mirrors the original server model more closely:
  - fighter records for player and enemies
  - runtime combatant ids
  - stable logical ids
  - current `hp/mp/rage`
  - `row/col/side`
  - encounter `round`
  - fight `phase`
  - last action metadata
  This does not yet reproduce the original server's full fighter-owned update objects, but it gives the local harness a proper server-side source of truth for combat state instead of scattered per-packet fields.
- Live correction:
  individual enemy HP was already being tracked correctly in the synthetic fight state.
  The bug was in the control flow after a lethal hit: a single enemy death in a multi-enemy fight was still falling into the single-target death/result branch, which could make the client show end-of-battle UI early.
  The harness now only ends the fight when all enemies are dead.
- Local defeat-path completion:
  the synthetic player fighter is no longer clamped to `1 HP`.
  Enemy turns can now reduce player HP to `0`, at which point the harness marks the encounter `finished`, clears the queued enemy actions, and ignores further inbound `0x03ed` action/ready packets for that fight.
  The current defeat response is still minimal (dialogue plus local state transition), not a confirmed reconstruction of the original server's defeat-result packet flow.
- Turn-cadence correction:
  the local harness now models a queue of enemy actions after a non-lethal player hit in a multi-enemy fight.
  Instead of reopening command selection after the first retaliation, it drains the queued live enemy turns on successive client `0x03ed / 0x09` packets, updating synthetic player HP after each hit.
  While that queue is non-empty, the harness now sends `0x03fa / 0x33` keyed to the next acting enemy's runtime id so the wheel does not remain visible between enemy actions.
  Only after the queue is exhausted does it re-send `0x03fa / 0x34` plus `0x03f0`.
  This is still a synthetic stand-in for the original server's richer fight-list execution, but it better matches the expected full-round turn flow.
- Player-state sync gap:
  live testing showed enemy playback alone was not enough: the client did not visibly update player HP and did not reliably return to command state.
  The local harness now follows enemy playback with a `0x03f6 / 0x0a` self-state sync sourced from the synthetic player fighter before re-sending `0x34 + 0x03f0`.
- Original server monster-seeding detail:
  `macro_AddFightMonster(monster_id, row, col, level_like, logical_id)` feeds `FUN_0042fe00(...)`.
  That function:
  - places the fighter with `FUN_004371b0(fight_ctx, fighter, row, col, side=1)`
  - seeds fighter fields:
    - `fighter + 0x3bc = row`
    - `fighter + 0x3bd = col`
    - `fighter + 0x3be = side`
  - stores `logical_id -> runtime_id` into the fight-context map at `fight_ctx + 0x10`
  The local synthetic fight state now carries those logical ids too, even though the client's normal-attack packet still targets by row/col rather than by logical id.
- Target-byte confirmation:
  the original server helper `FUN_004316c0` resolves a default target through `FUN_00436730(...)` and copies the chosen target's `+0x3bc/+0x3bd` fields into the acting fighter's pending-order bytes.
  This confirms that the two target bytes in the normal attack path are row/col selectors, not the script logical id.
- Duplicate command-refresh correction:
  the client commonly sends one more bare `0x03ed / 0x09` immediately after a valid command refresh at the end of the enemy round.
  Relying only on `phase === command` and `awaitingPlayerAction` was not sufficient to suppress the redundant reopen in the local harness.
  The synthetic fight state now carries an explicit `suppressNextReadyRepeat` latch that is set whenever the harness sends `0x01 + 0x34 + 0x03f0` and is cleared when the player or an enemy actually takes an action.
  That makes the next post-refresh `0x03ed / 0x09` a no-op instead of reopening the wheel twice.
- Turn-pacing adjustment:
  reopening commands immediately after the last queued enemy playback made the wheel appear too early relative to the visual timing of the enemy action.
  The local harness now delays the end-of-round `0x01 + 0x34 + 0x03f0` refresh by a short timer (`700ms`) so the wheel returns after the enemy action has visibly settled.
- `Combat data error!` isolation:
  with the fight-enter packet now stable and multi-enemy playback working, the remaining popup is more likely tied to the synthetic `0x03f0` command table than to the `0x65` encounter rows.
  The harness now uses a single-row minimal `0x03f0` profile based on the first reference action id instead of advertising six guessed reference skills at once.
  This is intended to test whether extra invalid action rows are what trigger the client's combat-data popup while still leaving the basic `atk` flow intact.
