# zo-server

## Workspace Layout

- `apps/game-server`: TypeScript game server, runtime DB utilities, and the game-server Docker image
- `apps/portal`: Next.js portal
- `data`, `db`, `runtime`: shared repo assets and infrastructure consumed by the app workspaces

## Docker

Build and run the server with Docker Compose:

```bash
npm run dev
```

The server listens on TCP port `7777` by default.
The required map binaries are now vendored under `data/client/map`, so no external client path is needed for normal startup.

`npm run dev` is Docker-backed and brings up Postgres, runs Flyway migrations, and starts the server container.

Monorepo apps exposed in Docker dev:

- Game server: `tcp://localhost:7777`
- Next.js portal: `http://localhost:3000`
- Signup portal: `http://localhost:3000/signup`
- Admin portal: `http://localhost:3000/admin`

Behind Traefik, the same portal service can be exposed on subdomains:

- Signup portal: `https://signup.<your-domain>/`
- Admin portal: `https://admin.<your-domain>/`

When the request host starts with `signup.` or `admin.`, the portal serves the matching page at `/` and redirects cross-navigation to the matching subdomain.

### Database workflow

Run Flyway manually when needed:

```bash
npm run db:migrate
```

Import static JSON into Postgres:

```bash
npm run db:import:static
```

Import structured quest definitions into Postgres:

```bash
npm run db:import:quest2
```

Import static JSON into Postgres and remove the source JSON files afterward:

```bash
npm run db:import:static:purge
```

Import character save JSON into Postgres:

```bash
npm run db:import:characters
```

Import static JSON, structured quest definitions, and character saves in sequence:

```bash
npm run db:import:all
```

### Runtime mounts

- `./data/save` persists split character save data until it is migrated into Postgres.
- `./runtime` stores `server.log`, `characters.json`, and `combat-probe-state.json`.
- `./postgres-data` stores the Postgres data directory as a bind mount, so `docker compose down -v` does not remove database data.
- `apps/portal/public/downloads/ZO.zip` is a gitignored portal download asset. `make deploy` still rsyncs it to the server, and Compose bind-mounts it into the portal container.

### Environment overrides

- `PORT`: host port exposed by Compose.
- `GAME_BIND_HOST`: host interface bound for the game server. Defaults to `0.0.0.0`.
- `BIND_HOST`: TCP interface the server listens on. Defaults to `0.0.0.0`.
- `SERVER_HOST`: host/IP advertised to clients in the login server-list and redirect packets. Defaults to `127.0.0.1`.
- `POSTGRES_BIND_HOST`: host interface bound for Postgres in `compose.local.yaml`. Defaults to `127.0.0.1`.
- `PORTAL_BIND_HOST`: host interface bound for the Next.js portal in `compose.local.yaml`. Defaults to `0.0.0.0`.
- `MAP_CLIENT_ROOT`: optional override for the client map data root. Defaults to `/app/data/client`.
- `COMBAT_REFERENCE_ROOT`: container path for the combat reference dataset.
- `VERBOSE_SESSION_PACKET_LOGS`: set to `1` to re-enable raw recv/send packet logs, decoded ASCII, and hex dumps. By default those transport-level logs stay quiet.

## Deploy

Deploy to `ubuntu@orc.webcap.site` with the default SSH key path:

```bash
make deploy
```

`make deploy` now performs the full remote bootstrap in order:

1. sync the repo to the VM
2. build the `zo-server` and `portal` images
3. start Postgres
4. run Flyway migrations
5. run the game-server `db:import:all` pipeline, which imports static JSON, structured `quest2` definitions, and character JSON into Postgres
6. remove the migrated live character JSON saves as part of the character-import phase
7. start `postgres`, `zo-server`, and `portal`

The base deploy stack does not publish Postgres or portal ports directly. Postgres stays internal to Docker, and the portal is expected to be exposed through Traefik when [`compose.traefik.yaml`](/home/nikon/projects/zo-server/compose.traefik.yaml) is active.

By default, deploy also prunes unused Docker images and build cache on the remote host after the stack comes up.
Unused volume pruning is available, but stays off by default because it affects all unused Docker volumes on that host.

Override deployment settings when needed:

```bash
make deploy DEPLOY_HOST=ubuntu@example.com DEPLOY_KEY=~/.ssh/other_key DEPLOY_DIR=/home/ubuntu/zo-server
```

Enable remote volume pruning explicitly when you want it:

```bash
make deploy DEPLOY_PRUNE_VOLUMES=1
```

### Traefik portal hosts

If the remote host has a shared Traefik instance and a `traefik-public` Docker network, `make deploy` automatically includes [`compose.traefik.yaml`](/home/nikon/projects/zo-server/compose.traefik.yaml).

By default it targets:

```bash
signup.zo.webcap.site
admin.zo.webcap.site
```

Those defaults match the existing `webcap-platform` Traefik host convention (`*.webcap.site`). Override them in the server-side `.env` only if needed:

```bash
PORTAL_SIGNUP_HOST=signup.example.com
PORTAL_ADMIN_HOST=admin.example.com
```

Local `npm run dev` continues to use plain path routes on `localhost`.
