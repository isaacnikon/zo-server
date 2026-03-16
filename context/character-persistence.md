# Character Persistence

## Current Problem

- [characters.json](/home/nikon/projects/zo-server/characters.json) is a single account-keyed blob.
- It already mixes:
  - character identity
  - scene position
  - vitals and attributes
  - currencies and progression
  - quest state
  - inventory state
- That is fine for one local test character, but it will get noisy and expensive once inventory, loot, stores, skills, pets, and more quest history accumulate.

## Recommendation

Yes, we should break it up meaningfully now.

The right split is not “more nested JSON”. The right split is a normalized persistence model that we can keep in:
- split JSON files first
- SQLite later
- Postgres later if needed

## Proposed Database Structure

### `accounts`

- `account_id` text primary key
- `created_at` timestamp
- `last_login_at` timestamp

### `characters`

- `character_id` text primary key
- `account_id` text not null
- `name` text
- `entity_type` integer
- `role_entity_type` integer
- `role_data` integer
- `selected_aptitude` integer
- `level` integer
- `experience` integer
- `status_points` integer
- `renown` integer
- `gold` integer
- `bank_gold` integer
- `bound_gold` integer
- `coins` integer
- `map_id` integer
- `x` integer
- `y` integer
- `last_town_map_id` integer nullable
- `last_town_x` integer nullable
- `last_town_y` integer nullable
- `created_at` timestamp
- `updated_at` timestamp

### `character_vitals`

- `character_id` text primary key
- `current_health` integer
- `current_mana` integer
- `current_rage` integer
- `updated_at` timestamp

### `character_attributes`

- `character_id` text primary key
- `intelligence` integer
- `vitality` integer
- `dexterity` integer
- `strength` integer
- `updated_at` timestamp

### `character_active_quests`

- `character_id` text
- `task_id` integer
- `step_index` integer
- `status` integer
- `progress_json` json/text
- `accepted_at` timestamp

Primary key:
- `(character_id, task_id)`

### `character_completed_quests`

- `character_id` text
- `task_id` integer
- `completed_at` timestamp

Primary key:
- `(character_id, task_id)`

### `character_inventory_items`

- `instance_id` integer primary key
- `character_id` text
- `container_type` integer
- `slot` integer
- `template_id` integer
- `quantity` integer
- `bind_state` integer default 0
- `state_code` integer default 0
- `extra_value` integer default 0
- `attributes_json` json/text nullable
- `created_at` timestamp
- `updated_at` timestamp

Indexes:
- `(character_id, container_type, slot)`
- `(character_id, template_id)`

### `character_inventory_state`

- `character_id` text primary key
- `bag_size` integer
- `next_item_instance_id` integer
- `next_bag_slot_hint` integer
- `updated_at` timestamp

## Why This Split Works

- quest updates stop rewriting the whole character document
- bag item mutations become first-class rows
- reward items, loot, consumables, and shop purchases all fit naturally
- migration to a real DB becomes mechanical instead of interpretive

## File-Based Intermediate Layout

If we want to split before adding SQLite, use:

- `data/save/accounts/<account_id>.json`
- `data/save/characters/<character_id>/profile.json`
- `data/save/characters/<character_id>/vitals.json`
- `data/save/characters/<character_id>/attributes.json`
- `data/save/characters/<character_id>/active-quests.json`
- `data/save/characters/<character_id>/completed-quests.json`
- `data/save/characters/<character_id>/inventory-items.json`
- `data/save/characters/<character_id>/inventory-state.json`

That preserves the same logical boundaries as the eventual DB schema.

## Suggested Next Refactor

Introduce a repository layer above [character-store.js](/home/nikon/projects/zo-server/src/character-store.js):

- `loadCharacter(accountId)`
- `saveCharacter(characterSnapshot)`

Then the runtime stops caring whether persistence is:
- monolithic JSON
- split JSON files
- SQLite
- Postgres
