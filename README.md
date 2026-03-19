# zo-server

## Docker

Build and run the server with Docker Compose:

```bash
docker compose up --build
```

The server listens on TCP port `7777` by default.
The required map binaries are now vendored under `data/client/map`, so no external client path is needed for normal startup.

### Runtime mounts

- `./data/save` persists split character save data.
- `./runtime` stores `server.log`, `characters.json`, and `combat-probe-state.json`.

### Environment overrides

- `PORT`: host port exposed by Compose.
- `BIND_HOST`: TCP interface the server listens on. Defaults to `0.0.0.0`.
- `SERVER_HOST`: host/IP advertised to clients in the login server-list and redirect packets. Defaults to `127.0.0.1`.
- `FORCE_START_SCENE`: set to `1` to enable the existing forced-start-scene behavior.
- `MAP_CLIENT_ROOT`: optional override for the client map data root. Defaults to `/app/data/client`.
- `COMBAT_REFERENCE_ROOT`: container path for the combat reference dataset.

## Deploy

Deploy to `ubuntu@orc.webcap.site` with the default SSH key path:

```bash
make deploy
```

Override deployment settings when needed:

```bash
make deploy DEPLOY_HOST=ubuntu@example.com DEPLOY_KEY=~/.ssh/other_key DEPLOY_DIR=/home/ubuntu/zo-server
```
