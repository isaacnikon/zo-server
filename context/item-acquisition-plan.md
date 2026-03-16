# Item Acquisition Plan

## Current Server State

- Minimal server-side inventory support now exists in [src/inventory.js](/home/nikon/projects/zo-server/src/inventory.js).
- Session state persists:
  - bag items
  - bag size
  - next item instance id
  - next bag slot
- Quest item grants already use this path through [src/session.js](/home/nikon/projects/zo-server/src/session.js).
- The server emits an experimental `0x03f3` item-add packet from [src/protocol/gameplay-packets.js](/home/nikon/projects/zo-server/src/protocol/gameplay-packets.js).

### What works

- bag state persists in character data
- login-time inventory replay exists
- quest engine can grant items into the bag model

### What does not yet work reliably

- the client does not consistently render granted items in the bag
- `0x03f3` serialization is still only partially decoded
- item-backed quest steps cannot yet be considered complete UX

## Client Findings

- `gc12.exe` registers `0x03f3` to `FUN_00501f60` via `FUN_00514c00`. This is the generic item-receive/update path.
- `FUN_00501f60` parses one byte first, then builds an item object with `FUN_00547650` and `FUN_00547740`, prints `Get item #0[%d]%s`, refreshes bag UI, and if the first byte is `0x01` it also checks bag capacity and can show `Pack is full, please sort it`.
- `FUN_00547740` reads a `u16` item/template id into item offset `+0x40`, resolves template data from `DAT_008ed804`, then parses additional item-instance data with `FUN_00540100`. Purchases and pickups must send a real serialized item instance, not just an item id.
- `gc12.exe` registers `0x03f6` to `FUN_00432270` -> `FUN_00430300`. This handler updates gold, coins, renown, exp, bag money UI, and system messages.
- In `FUN_00430300`, subcase `0x0c` uses a leading discriminator byte:
  - `'$'` updates gold and shows `Cost gold...` or `Get gold...`
  - `'N'` updates coins
  - `'-'` updates renown
  - `'!'` updates experience
- `gc12.exe` registers `0x0412` to `FUN_0050c0e0`. That handler is a separate VIP purchase result path, not the normal gold shop path.
- Slash/script command `/openstore ...` in `FUN_004126a0` sends `0x044e` with sub `0x32` plus a store name/string. This appears to open store UI.
- Shop buy confirmation is visible in `FUN_0048b9a0`. When source type `7` is moved to target type `1`, the client shows `Are you sure to buy %s by paying %d gold?` and, after confirmation, calls inventory-manager methods through vtable slots. Those methods likely emit the real purchase request packet.
- `FUN_0048b9a0` also shows other container moves:
  - bag full checks
  - bag <-> VIP bag moves
  - booth/sell flows
  This suggests the client uses one general item-transaction system for move/buy/sell, not one bespoke packet per action.

## What This Means

- Normal store purchases are not driven by `0x0412`.
- The server must support three distinct layers:
  - opening the store UI
  - receiving a client purchase or move request
  - replying with bag item insertion plus currency update
- Ground drops and other pickups should probably reuse the same receive-side `0x03f3` item-add path and `0x03f6` currency or value sync path.
- The main unknown is the exact outbound client request packet for:
  - buying from a normal shop
  - picking up a dropped item from the map
  - possibly selling or moving items between containers

## Additional Quest-specific Finding

- Matt's wood handoff in `Back to Earth` is not sent from client to server as an item transfer.
- The client sends a `0x03f1` callback with `sub=0x02`, `script=10000`.
- The server must interpret that callback and create the bag item itself.
- This confirms quest item delivery depends on the same unresolved `0x03f3` bag serialization work as stores and drops.

## Implementation Plan

### 1. Reverse-engineer the remaining client request packets before server work

- Capture the exact outbound packet when:
  - opening a normal NPC shop
  - clicking buy on a normal gold item
  - picking up a dropped ground item
  - selling one item back to a shop
- Confirm whether normal shop buy is:
  - `0x0406` with a subtype
  - `0x044e` continuation traffic
  - or an inventory-manager packet on another opcode
- Confirm whether ground pickup is:
  - a dedicated pickup opcode
  - or another inventory or container move opcode

### 2. Build the server item model first

- Add static item-template data:
  - template id
  - display name
  - stackability
  - max stack
  - buy and sell price
  - bag slot constraints
  - optional durability and quality fields
- Add item-instance data:
  - unique instance id
  - template id
  - quantity
  - bound flags
  - durability
  - enhancement and socket fields if present
- Add inventory containers:
  - main bag
  - equipment
  - VIP bag if needed later
  - temporary drop or loot container abstraction for map items

### 3. Implement server-side shop catalogs

- Represent shops by stable store key or name because `/openstore` sends a string.
- Map NPC or script interaction to a shop key.
- Return catalog rows matching what the client expects to render:
  - item template
  - price
  - currency type
  - any availability flags
- Keep this gold-shop path separate from VIP shop logic.

### 4. Implement the normal purchase transaction

- On purchase request:
  - validate shop key and item exists
  - validate quantity
  - validate currency amount
  - validate bag space or stack merge possibility
  - deduct gold atomically
  - create item instance or increase stack
- Reply in this order:
  - send `0x03f3` item-add or update so the item appears in bag
  - send `0x03f6` currency update for gold reduction
  - send any additional shop refresh packet only if the client expects stock or price changes
- If bag is full:
  - reject cleanly with the client-visible failure path instead of creating the item then rolling back

### 5. Implement generic item insertion utilities

- One server helper should own:
  - finding stack targets
  - allocating empty bag slots
  - serializing the `0x03f3` payload
- Use that same helper for:
  - shop purchases
  - quest rewards
  - admin rewards
  - drop pickups
  - future mail and gift claims

### 6. Implement map drops as first-class world entities

- Add a drop entity model:
  - drop id
  - template id or item instance
  - quantity
  - map, x, y
  - owner or party lock
  - expiry time
- Add spawn and despawn protocol support for drop objects after confirming the client’s world-item entity opcode.
- Track visibility and pickup eligibility server-side.

### 7. Implement ground item pickup

- On pickup request:
  - validate drop exists
  - validate distance
  - validate ownership or lock rules
  - validate inventory space
  - move drop item into inventory using the same insertion helper
  - remove drop from world
- Reply in this order:
  - item add via `0x03f3`
  - optional gold or coins sync via `0x03f6` if the drop is currency
  - world despawn or update packet for the removed drop

### 8. Implement currency pickups separately from item pickups

- Gold or coin drops should likely skip `0x03f3` and only use:
  - world despawn
  - `0x03f6/0x0c` value update with the right discriminator byte
- This matches the client’s dedicated money update handler and its `Cost/Get gold` system messages.

### 9. Implement sale or back-to-shop only after purchase works

- The same client code in `FUN_0048b9a0` handles sell-related UI.
- After purchase is stable, add:
  - inventory remove or update
  - gold increase via `0x03f6`
  - optional success message or shop refresh

### 10. Add server-side invariants before exposing any of it

- Never trust client item id, price, quantity, or slot ownership.
- Recompute all prices server-side.
- Treat all move, buy, pickup, and sell operations as atomic transactions.
- Log rejected requests with opcode, subtype, item id, quantity, gold, and bag state.

## Recommended Research Order Before Coding

1. Identify the exact normal shop purchase request packet.
2. Identify the exact world-drop spawn and pickup request packet.
3. Fully decode the `0x03f3` item serialization fields by instrumenting `FUN_00547740` and `FUN_00540100`.
4. Verify whether one-item add packet is enough for stack updates and multi-quantity buys, or whether the client expects one packet per slot changed.

## Recommended Build Order

1. Item templates, inventory containers, and `0x03f3` serializer
2. Gold shop open and buy one item
3. Generic bag insertion and stack merging
4. World drops and pickup
5. Selling and other collection sources
6. VIP shop alignment only if needed

## Biggest Unknowns Still Open

- Exact outbound packet for normal gold-shop buy
- Exact outbound packet for ground-item pickup
- Full `0x03f3` item-instance field layout beyond template id and parsed extra blob
- Exact world-drop spawn and despawn opcode for visible ground loot

## Additional Packet Map

- `FUN_00514c00` is the relevant client dispatcher registration point for this work.
- Known inbound receive-side registrations:
  - `0x03f3` -> `FUN_00504bd0` -> `FUN_00501f60`
  - `0x03f6` -> `FUN_00504b90` -> `FUN_00432270` -> `FUN_00430300`
  - `0x0412` -> `FUN_0050c0e0`
- `0x03f3` is the generic item arrival path:
  - parses a leading container byte
  - allocates an item object with `FUN_00547650`
  - parses item template and state with `FUN_00547740`
  - emits `Get item ...`
  - refreshes bag UI
- `0x03f6` subcase `0x0c` is the generic value update path for:
  - gold
  - coins
  - renown
  - experience
- `/openstore <name>` from `FUN_004126a0` sends `0x044e` sub `0x32` with a string payload.
- Normal buy confirmation lives in `FUN_0048b9a0`, but the exact emitted purchase request is still behind inventory-manager virtual calls and remains unresolved.
