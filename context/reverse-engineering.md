# Reverse Engineering Notes

## Source Of Truth
- Prefer, in order:
  - live client UI / runtime behavior
  - client binary handlers in `gc12.exe`
  - client archive data from `gcg/attrres.rc`
  - extracted dumps or copied server-side resources
- Practical rule:
  - if dump output disagrees with the running client, the dump is wrong for server behavior purposes.

## Current Data Pipeline
- Client archive:
  - `/home/nikon/Data/Zodiac Online/gcg/attrres.rc`
- Full extraction:
  - `scripts/extract-client-archive.py`
  - output: `data/client-derived/archive/`
  - manifest: `data/client-derived/archive/attrres-manifest.json`
- Derived table generation:
  - `scripts/generate-client-derived-tables.py`
  - source is the extracted repo copy, not the live install path
- Current derived JSON:
  - `equipment.json`
  - `weapons.json`
  - `items.json`
  - `potions.json`
  - `stuff.json`
  - `iteminfo.json`
  - `combinitem.json`
  - `weektask.json`
  - `helpfiles.json`
  - `roleinfo.json`
  - `quests.json`

## Working So Far
- `Spinning(II)` completion path is fixed:
  - no premature auto-complete on field triggers
  - completion only happens on the correct NPC hand-in
- `Spinning(II)` rewards now match the real client quest panel:
  - male: `10001` `Light Hood` + `13001` `Shoes`
  - female: `15001` `Red String` + `18001` `Embroidered Shoes`
- Equipment/inventory state now works for starter gear:
  - items render in bag
  - durability uses the client scaling rule
  - equip/unequip persists
  - equipped items live in equipment container `0`
  - equipped items are excluded from bag container `1`
- Inventory definitions now load from client-derived data:
  - general items from `items.json`
  - potions from `potions.json`
  - stuff items from `stuff.json`
  - equipment/weapons from `equipment.json` / `weapons.json`
- Role-derived runtime data now works:
  - monster primary drop lookup from `roleinfo.json`
  - monster name lookup from `roleinfo.json`
  - starter-role gender lookup from `roleinfo.json`
  - scene ordinary-monster lookup by location text from `roleinfo.json`

## Key Verified Findings
- Client inventory/equipment:
  - `0x03f2` is the inventory container update family
  - container `0` = equipped items
  - container `1` = bag
  - `0x03f2 / 0x17` is the bag position update
- Equipment durability:
  - equipment current durability is encoded as a scaled instance field
  - fresh starter gear needed full-scale values, not literal `10`
- Quest reward panels:
  - the real in-game quest/help window can disagree with script dump assumptions
  - reward validation should use live client UI and binary/UI behavior, not just extracted text
- `roleinfo.txt`:
  - `roleClassField=1` player avatars
  - `roleClassField=2` pets
  - `roleClassField=3` NPCs
  - `roleClassField=4` ordinary monsters
  - `roleClassField=5` elite/guard/boss style roles
  - current practical drop read:
    - `statFields[30]` = primary drop item id
    - `tailFields[0]` = candidate primary drop chance/weight
  - current server uses that second field as a simple `N/100` chance until better decoding exists

## Bling Spring
- Client-derived ordinary monster set for `Bling Spring` is:
  - `5001` `Dragonfly`
  - `5002` `Beetle`
- Current runtime:
  - scene pool is built from `roleinfo` location membership, not hardcoded ids
  - names and primary drops also come from `roleinfo`
- Verified drops:
  - `5001` -> `23015` `Dragonfly Wing`, chance `30`
  - `5002` -> `23003` `Beetle Shell`, chance `30`
  - `5206` -> `23115` `Poisonous Fang`, chance `30`

## Important Mistakes Already Corrected
- Wrong assumption:
  - copied server-side `third_party` tables were treated as authoritative
  - corrected by extracting and deriving from the client archive
- Wrong assumption:
  - `Spinning(II)` reward ids were inferred from dump/script text only
  - corrected by using the real in-game reward panel and client item tables
- Wrong assumption:
  - starter-role gender should be inferred from odd/even id only
  - corrected to prefer client-derived role names from `roleinfo`
- Wrong assumption:
  - equipped-state restore should use `0x03ee`
  - corrected to use inventory container sync on `0x03f2`, container `0`
- Wrong assumption:
  - equipped items could remain in the bag container
  - corrected so equipped items only appear in equipment container `0`

## Runtime Modules Added
- `src/roleinfo.js`
  - role lookup
  - primary drop lookup
  - role gender lookup
  - location extraction
  - encounter pool builder by location
- `src/crafting-data.js`
  - `combinitem.json` queries
  - `iteminfo.json` lookup
  - `stuff.json` lookup

## Current Limits
- No real crafting runtime yet
  - only client-derived crafting/material data accessors exist
- `iteminfo.json` semantics are only partially decoded
- `combinitem.json` is parsed and queryable, but not yet enforced in gameplay
- Scene encounter coverage is only implemented where the server already has encounter triggers
- Full `roleinfo` stat-field semantics are still only partly decoded

## Next Best Steps
- Use `src/crafting-data.js` when implementing actual compose/socket/refine handlers
- Expand client-derived scene monster pools beyond `Bling Spring` as more maps get encounter triggers
- Continue replacing hand-maintained monster/item behavior with `roleinfo.json`, `iteminfo.json`, and `combinitem.json`
