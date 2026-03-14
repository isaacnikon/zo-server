'use strict';

const net = require('net');

const { CHARACTER_STORE_FILE, LOG_FILE, PORT } = require('./config');
const { CharacterStore } = require('./character-store');
const { createLogger } = require('./logger');
const { MapCellStore } = require('./map-cell-store');
const { Session } = require('./session');
const { createSessionState } = require('./session-state');

function startServer() {
  const logger = createLogger(LOG_FILE);
  const sharedState = createSessionState();
  sharedState.characterStore = new CharacterStore(CHARACTER_STORE_FILE);
  sharedState.mapCellStore = new MapCellStore();

  const server = net.createServer((socket) => {
    const isGame = sharedState.nextSessionIsGame;
    sharedState.nextSessionIsGame = false;
    sharedState.sessionCount += 1;

    const session = new Session(socket, sharedState.sessionCount, isGame, sharedState, logger);
    const addr = `${socket.remoteAddress}:${socket.remotePort}`;
    logger.log(`\n=== SESSION ${session.id} CONNECTED from ${addr} mode=${isGame ? 'GAME' : 'LOGIN'} ===`);
    session.sendHandshake();

    socket.on('data', (data) => {
      try {
        session.feed(data);
      } catch (err) {
        logger.log(`[S${session.id}] Error: ${err.message}\n${err.stack}`);
      }
    });

    socket.on('close', () => {
      session.dispose();
      logger.log(`[S${session.id}] Disconnected`);
    });
    socket.on('error', (err) => logger.log(`[S${session.id}] Socket error: ${err.message}`));
  });

  server.listen(PORT, '0.0.0.0', () => {
    logger.log(`Zodiac Online server listening on port ${PORT}`);
    logger.log(`Logs: ${LOG_FILE}`);
  });

  server.on('error', (err) => {
    console.error('Server error:', err.message);
    process.exit(1);
  });

  return server;
}

module.exports = {
  startServer,
};
