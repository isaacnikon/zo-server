# Quest & Story System

## Current Runtime

- Quest lifecycle packets are implemented on the server with `GAME_QUEST_CMD (0x03ff)`.
- Client-visible quest sync currently uses:
  - `0x03ff / 0x03` accept
  - `0x03ff / 0x04` complete
  - `0x03ff / 0x05` abandon
  - `0x03ff / 0x08` status update
  - `0x03ff / 0x0e` task history update
  - `0x03ff / 0x0c` NPC marker
- The server also reacts to `GAME_SERVER_RUN_CMD (0x03f1)` NPC/script callbacks and uses those as quest triggers.

## Implemented Server Architecture

### Data-driven quest engine

- Runtime quest logic lives in [src/quest-engine.js](/home/nikon/projects/zo-server/src/quest-engine.js).
- Live quest definitions are loaded from [data/quests/main-story.json](/home/nikon/projects/zo-server/data/quests/main-story.json).
- The maintained source of truth for hand-authored runtime details is [data/quests/main-story.overrides.json](/home/nikon/projects/zo-server/data/quests/main-story.overrides.json).

Each live quest can define:

- `acceptNpcId`
- `acceptSubtype`
- `prerequisiteTaskIds`
- `steps`
- `rewards`

Supported step types today:

- `talk`
- `kill`
- `transition`

Supported quest-side effects today:

- accept
- progress/status update
- completion
- item grant event emission
- NPC marker sync

### Persistence

- Character quest state is persisted in [characters.json](/home/nikon/projects/zo-server/characters.json).
- Normalized fields:
  - `activeQuests`
  - `completedQuests`

### Inventory linkage

- Minimal bag state exists in [src/inventory.js](/home/nikon/projects/zo-server/src/inventory.js).
- Quest events can emit `item-granted`, which [src/session.js](/home/nikon/projects/zo-server/src/session.js) turns into:
  - bag persistence update
  - authoritative `0x03f2 / 0x00` bag sync
  - `0x03f3` item-arrival packet when needed

## Client Extraction Pipeline

### Verified asset sources

- Installed client task metadata:
  - [data/client-verified/tasks/tasklist.txt](/home/nikon/projects/zo-server/data/client-verified/tasks/tasklist.txt)
  - [data/client-verified/tasks/tasklist.json](/home/nikon/projects/zo-server/data/client-verified/tasks/tasklist.json)
- Installed client help/script text:
  - extracted from `/home/nikon/Data/Zodiac Online/gcg/script.gcg`
  - normalized to [data/client-verified/quests/client-help-quests.json](/home/nikon/projects/zo-server/data/client-verified/quests/client-help-quests.json)

### Generation scripts

- [scripts/extract-client-quest-help.js](/home/nikon/projects/zo-server/scripts/extract-client-quest-help.js)
  - extracts:
    - `taskId`
    - title/help variant
    - start NPC ids
    - map ids
    - target NPC ids inferred from `macro_GetTypeNpcName(...)`
    - item ids
    - goal count
    - referenced task ids
- [scripts/generate-main-story-quests.js](/home/nikon/projects/zo-server/scripts/generate-main-story-quests.js)
  - merges extracted help with runtime overrides into `data/quests/main-story.json`
- [scripts/generate-quest-catalog.js](/home/nikon/projects/zo-server/scripts/generate-quest-catalog.js)
  - builds [data/quests/generated/catalog.json](/home/nikon/projects/zo-server/data/quests/generated/catalog.json)

### Catalog status model

Generated catalog entries are classified as:

- `runnable`
- `needs_override`
- `metadata_only`

This is the staging shape intended for a future database import.

## Current Live Quest Set

Runnable quests currently promoted into `main-story.json`:

- `1` Back to Earth
- `408` Achelous's Tortoise
- `426` Rebel in Hell
- `467` Elfin
- `481` Vulture Fight

Verified/implemented patterns:

- accept from specific NPC click
- kill objective progression from synthetic combat completion
- talk hand-in progression
- prerequisite gate enforcement

## Proven Client-verified Example

`Back to Earth` is the most verified quest path so far:

1. Apollo accepts the quest
2. Apollo hands off a recommendation token for Blacksmith
3. Blacksmith advances the quest and sends the player to Matt
4. Matt triggers `0x03f1 sub=0x02 script=10000`
5. Server grants timber item `21116`
6. Blacksmith hand-in completes the quest

This was verified against the installed client task/help data and live packet logs.

## Known Gaps

### Item-backed quest completion is still incomplete

- The server now sends both:
  - `0x03f2 / 0x00` authoritative bag full-sync
  - `0x03f3` item receive packets for item-arrival UX
- The server also sends `0x03ff / 0x0e` on completion/bootstrap so the client updates `macro_GetTaskHistoryLevel(...)`.
- Without that history packet, an NPC script can re-offer a completed quest even when the server save already has the task in `completedQuests`.
- Live client debugging showed the quest token `21098` can exist in the authoritative bag tree and still fail the quest UI count.
- The concrete client-side count path is `LuaMacro_GetItemCount -> FUN_0053e2a0`.
- For template family `0x74` items such as quest token `21098`, that counter reads the parsed `u16` quantity field at `clientItem + 0x08`, not merely node presence.
- A prior server serializer bug populated the preceding `u8` field instead, which made the item visible in the bag while `macro_GetItemCount(21098)` still returned `0`.
- Live March 17 bag debugging also confirmed a second serializer failure:
  - starter rewards `20001` and `20004` are client template family `0x41`
  - family `0x41` stops parsing after the base fields plus the embedded-entry count byte
  - sending the generic six trailing `u16` fields shifts the next item in `0x03f2 / 0x00`, so only the first bag item becomes a live client item
  - fixing `0x03f2`/`0x03f3` to serialize by template family restored both visible starter items
- Result: for item-backed quests, do not trust bag visibility alone; verify the counted quantity field used by `FUN_0053e2a0`.

### Full quest automation is not complete

- Many quests can be scaffolded from client help text.
- Help text alone does not recover:
  - exact `0x03f1` subtype per step
  - script callback ids for every NPC path
  - precise item-grant vs item-require semantics
  - exact hand-in packet behavior for every chain

## Recommended Next Promotion Strategy

Promote quests in this order:

1. talk-only quests
2. kill-plus-talk quests
3. item-backed quests only after the counted quantity field for the relevant item template family is confirmed

When promoting a quest:

1. verify task id and start NPC from `tasklist.json`
2. verify step hints from `client-help-quests.json`
3. add only the runtime details missing from extraction to `main-story.overrides.json`
4. regenerate `main-story.json` and `generated/catalog.json`
5. test against live client logs
