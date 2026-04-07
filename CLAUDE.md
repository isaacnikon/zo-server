# Zodiac Online Server

Private-server reimplementation for Zodiac Online, a 2D MMO client. TypeScript, ESM-only (`"type": "module"`, node16 resolution).

## Build & Run

```
npm run build        # build all workspaces
npm start            # start @zo/game-server
npm run dev          # docker compose dev stack
```

All relative imports use `.js` extensions (node16 module resolution).

## Repository Layout

```
apps/game-server/
  src/                  Server source (ESM TypeScript)
  server.ts             Entry point
  session.ts            Session class — implements GameSession interface
  types.ts              Shared types, GameSession interface, CombatState, QuestEvent union
  config.ts             Constants, command words, environment config
  protocol/             Packet building and parsing
  handlers/             Packet dispatch and request handling
    packet-dispatcher.ts  Routes packets to handlers via Map<cmd, handler>
    combat-handler.ts     Combat packet router, encounter lifecycle
    login-handler.ts      Login/role creation
    quest-handler.ts      Quest packet handling, quest event application
    player-state-handler.ts  Equipment, items, attribute allocation
    pet-handler.ts        Pet actions and sync
    npc-interaction-handler.ts  NPC talk/shop/quest interactions
    session-bootstrap-handler.ts  Enter-game sequence, NPC spawns
  combat/               Combat subsystem — Layer 1 (pure, no gameplay imports)
    combat-formulas.ts    Pure functions: damage, skill costs, enemy queries, skill level resolution
    encounter-builder.ts  Enemy pool construction
    packets.ts            Combat packet builders
  inventory/             Inventory subsystem
    data.ts               Item definitions, equipment checks, JSON loading
    bag.ts                Bag mutation, queries, normalization
    index.ts              Barrel re-export
  quest2/                Quest subsystem
    data.ts               Quest definitions, normalization, step/reward queries
    state.ts              Quest state machine: accept, advance, complete, abandon
    index.ts              Barrel re-export
  roleinfo/              Role/monster data from client
    data.ts               JSON loading, internal lookup tables
    queries.ts            Public query functions (drops, pets, encounters)
    index.ts              Barrel re-export
  db/                    Database layer — postgres pool, SQL helpers, auth, runtime online store
  gameplay/              Gameplay services (layer 2 — no handler imports)
    combat-resolution.ts  Turn resolution, victory/defeat, rewards, command prompts
    skill-resolution.ts   Skill use handling, cast playback
    combat-service.ts     Combat encounter entry point
    effect-executor.ts    Effect executor (grant/remove items, dialogue, scripts)
    quest-runtime.ts      Quest event dispatch and effect application
    item-use-runtime.ts   Consumable item resolution
    shop-runtime.ts       NPC shop buy/sell
    inventory-runtime.ts  Inventory packet sync
    reward-runtime.ts     Quest/combat reward distribution
    combat-drop-runtime.ts  Loot drops
    skill-runtime.ts      Skill learning and hotbar
    stat-sync.ts          Stat packet sync
    progression.ts        Level-up, experience
    max-vitals.ts         HP/MP/rage cap calculation
    session-flows.ts      Vitals baseline, player vitals resolution
    pet-runtime.ts        Pet normalization and record construction (Layer 2 — imports max-vitals)
    pet-service.ts        Pet state management and client sync
  scenes/                Map interactions, field combat triggers, map rotation
    index.ts              Barrel re-export
  character/             Character persistence, hydration, normalization
    normalize.ts          Attribute/skill/inventory normalization
    role-utils.ts         Role data derivation
    session-hydration.ts  Character loading into session state
    json-store.ts         JSON file-based character store
    postgres-store.ts     Postgres-backed character store
  triggers/              Trigger utilities (progress tracking, matcher)
  observability/         Packet tracing
  runtime-admin/         Admin command worker
scripts/                Data processing scripts (Python + TypeScript)
  extract/               Client binary data extraction
  generate/              Code/data generation from extracted data
  analysis/              Debugging and inspection tools
  patch/                 Client binary patching
apps/portal/            Next.js portal
tools/                  Standalone utilities (capture proxy, GCG extractor)
data/
  client/                Vendored client binaries (maps)
  client-derived/        Extracted JSON (items, roles, quests, shops)
  client-verified/       Human-curated corrections
  quests/                Quest definitions (main-story.json)
  save/                  Character save files
docs/                   Protocol and quest documentation
```

## Architecture

Four dependency layers — imports point downward only:

```
Layer 4: SESSION + WIRING   (session.ts, server.ts)
Layer 3: HANDLERS            (handlers/*, scenes/*, runtime-admin/*)
Layer 2: GAMEPLAY SERVICES   (gameplay/*)
Layer 1: DOMAIN CORE         (types, config, protocol, combat/, inventory, quest2, roleinfo, db/, triggers/)
```

## Key Patterns

- **GameSession interface** (`types.ts`): All handler/gameplay functions receive `GameSession`, not the concrete `Session` class. Properties are fully typed — no `SessionLike = any`.
- **Packet dispatch** (`packet-dispatcher.ts`): Uses `Map<number, handler>` with direct function imports — no string-based dispatch.
- **Combat state** is typed as `CombatState` (defined in `types.ts`), not `Record<string, any>`.
- **Quest events** use a discriminated union (`QuestEvent` in `types.ts`).
- **Barrel re-exports**: `inventory/`, `quest2/`, `roleinfo/`, `scenes/` each have an `index.ts` barrel. Import from the barrel (e.g., `from '../inventory/index.js'`).

## Current Combat Notes

- `Slaughter` (`1403`) uses a native class-13 cast packet plus a generic fallback cast probe for client animation playback.
- Delayed-cast skills now use `skillResolutionPhase` to separate the first client-ready event from impact completion.
- If a delayed-cast skill never sends a second completion packet, the server falls back to a short `await-impact-ready` timeout in `gameplay/combat-resolution.ts` so combat does not hang indefinitely.
