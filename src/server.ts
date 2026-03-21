import net from 'net';

const { BIND_HOST, CHARACTER_STORE_FILE, LOG_FILE, PORT } = require('./config');
const { CharacterStore } = require('./character-store');
const { createLogger } = require('./logger');
const { Session } = require('./session');
const { createSessionState } = require('./session-state');

export function startServer() {
  const logger = createLogger(LOG_FILE);
  const sharedState = createSessionState();
  sharedState.characterStore = new CharacterStore(CHARACTER_STORE_FILE);

  const server = net.createServer((socket) => {
    const isGame = sharedState.nextSessionIsGame;
    sharedState.nextSessionIsGame = false;
    sharedState.sessionCount += 1;

    const session = new Session(socket, sharedState.sessionCount, isGame, sharedState, logger);
    const addr = `${socket.remoteAddress}:${socket.remotePort}`;
    logger.log(
      `\n=== SESSION ${session.id} CONNECTED from ${addr} mode=${isGame ? 'GAME' : 'LOGIN'} ===`
    );
    session.sendHandshake();

    socket.on('data', (data: Buffer) => {
      try {
        session.feed(data);
      } catch (err) {
        const error = err as Error;
        logger.log(`[S${session.id}] Error: ${error.message}\n${error.stack}`);
      }
    });

    socket.on('close', () => {
      session.dispose();
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

  return server;
}
