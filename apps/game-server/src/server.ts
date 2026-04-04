import net from 'node:net';

import { BIND_HOST, CHARACTER_STORE_BACKEND, CHARACTER_STORE_FILE, LOG_FILE, PORT } from './config.js';
import { CharacterStore } from './character-store.js';
import { initializeStaticJsonStore } from './db/static-json-store.js';
import { clearRuntimeOnlinePlayers } from './db/runtime-online-store.js';
import { createLogger } from './logger.js';
import { PostgresCharacterStore } from './postgres-character-store.js';
import { initializeQuestDefinitions } from './quest2/definitions.js';
import { startRuntimeAdminCommandWorker } from './runtime-admin/runtime-admin-worker.js';
import { initializeSceneInteractions } from './scenes/map-interactions.js';
import { Session } from './session.js';
import { createSessionState } from './session-state.js';

export async function startServer() {
  const logger = createLogger(LOG_FILE);
  await initializeStaticJsonStore();
  await initializeSceneInteractions();
  await initializeQuestDefinitions();
  const sharedState = createSessionState();
  sharedState.characterStore = (
    CHARACTER_STORE_BACKEND === 'db'
      ? new PostgresCharacterStore(CHARACTER_STORE_FILE)
      : new CharacterStore(CHARACTER_STORE_FILE)
  ) as any;
  try {
    await clearRuntimeOnlinePlayers();
  } catch (error) {
    logger.log(`Failed to clear runtime online players: ${(error as Error).message}`);
  }
  const stopRuntimeAdminWorker = startRuntimeAdminCommandWorker(sharedState, logger);

  const server = net.createServer((socket) => {
    sharedState.sessionCount += 1;

    const session = new Session(socket, sharedState.sessionCount, false, sharedState, logger);
    sharedState.sessionsById.set(session.id, session);
    const addr = `${socket.remoteAddress}:${socket.remotePort}`;
    logger.log(
      `\n=== SESSION ${session.id} CONNECTED from ${addr} mode=UNKNOWN ===`
    );
    session.sendHandshake();

    socket.on('data', (data: Buffer) => {
      void session.feed(data).catch((err) => {
        const error = err as Error;
        logger.log(`[S${session.id}] Error: ${error.message}\n${error.stack}`);
      });
    });

    socket.on('close', () => {
      session.dispose();
      sharedState.sessionsById.delete(session.id);
      logger.log(`[S${session.id}] Disconnected`);
    });
    socket.on('error', (err: Error) => logger.log(`[S${session.id}] Socket error: ${err.message}`));
  });

  server.listen(PORT, BIND_HOST, () => {
    logger.log(`Zodiac Online server listening on ${BIND_HOST}:${PORT}`);
    logger.log(`Logs: ${LOG_FILE}`);
  });

  server.on('error', (err: Error) => {
    console.error('Server error:', err.message);
    process.exit(1);
  });

  server.on('close', () => {
    stopRuntimeAdminWorker?.();
  });

  return server;
}

startServer().catch((error) => {
  console.error('Server startup error:', (error as Error).message);
  process.exit(1);
});
