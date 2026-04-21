# Agent Instructions: zo-server

Private-server reimplementation for Zodiac Online (2D MMO). TypeScript ESM, ESM-only. Full arch & layering in [`CLAUDE.md`](CLAUDE.md).

## Commands

### Dev
- `npm run dev` — docker compose dev stack (compose.yaml + compose.local.yaml). Source-mounted, hot reload.
- `npm run dev:rebuild` — rebuild on first run if Dockerfiles or deps changed.
- Game server: `tcp://localhost:7777`
- Portal: `http://localhost:3000`

### Database
*All `db:import` scripts run against `dist/` — they need a prior build.*
- `npm run db:migrate` — Flyway migrate
- `npm run db:repair` / `npm run db:info` — Flyway repair / status
- `npm run db:import:static` — Import static JSON → Postgres
- `npm run db:import:quest2` — Import quest definitions → Postgres
- `npm run db:import:characters` — Import character saves → Postgres
- `npm run db:import:static:purge` — Import static JSON then delete source files
- `npm run db:import:all` — run the three imports in sequence
- `npm run reset:character` — build + reset a character

### Testing
- `npm run test` / `npm run test:game-server` — **typecheck** (`tsc --noEmit`). No runtime tests in CI.
- `npm run test:portal` — **build** (`next build`). No test framework.
- `npm run build` / `npm run build:game-server` / `npm run build:portal`

### Deploy
- `make deploy` — rsync → build images → Postgres → Flyway → `db:import:all` → start stack → prune
- `make deploy DEPLOY_HOST=... DEPLOY_KEY=... DEPLOY_DIR=...` — override host/key/dir
- Default deploy target: `ubuntu@orc.webcap.site`

## Monorepo
- `apps/game-server` — core game logic (`@zo/game-server`, `npm:pg`)
- `apps/portal` — Next.js 19 / React 19 admin + signup UI (`@zo/portal`)
- `data/`, `db/`, `runtime/` — shared assets (client maps, migrations, server logs)
- `scripts/` — Python + TS data processing (extract, generate, analysis, patch)

## TypeScript Rules
- **ESM only**. All relative imports **MUST** use `.js` extensions (e.g., `from './file.js'`).
- **Dependency layers**: Layer 4 (Session/Wiring) → Layer 3 (Handlers) → Layer 2 (Gameplay) → Layer 1 (Domain Core). Never import upwards.
- Use `GameSession` interface (not concrete `Session`) in all handlers/gameplay functions.
- Barrel imports for `inventory/`, `quest2/`, `roleinfo/`, `scenes/` (e.g., `from '../inventory/index.js'`).

## Gotchas
- **Delayed-cast skills** rely on `skillResolutionPhase` and a fallback timeout in `gameplay/combat-resolution.ts` to prevent hangs.
- **`SERVER_HOST`** must match the IP advertised to clients or connections fail.
- **Port `7777`** — the game server bind host is separate (`GAME_BIND_HOST` / `BIND_HOST` in compose/env).
- **`COMBAT_REFERENCE_ROOT`** points to an external ShengXiao server dataset path inside the container.
