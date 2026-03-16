'use strict';

const {
  SERVER_RUN_CONTEXT_SUBCMD,
  SERVER_RUN_MESSAGE_SUBCMD,
  SERVER_RUN_REST_SUBCMD,
} = require('../config');

function parseServerRunRequest(payload, sessionState) {
  if (payload.length < 5) {
    return {
      kind: 'invalid',
      reason: 'Short 0x03f1 payload',
    };
  }

  const subtype = payload[2];
  if (subtype === 0x03) {
    if (payload.length < 9) {
      return {
        kind: 'invalid',
        reason: 'Short 0x03f1/0x03 payload',
      };
    }
    const npcId = payload.readUInt32LE(3);
    const scriptId = payload.readUInt16LE(7);
    return {
      kind: 'npc-interact',
      subtype,
      npcId,
      scriptId,
      mapId: sessionState.currentMapId,
      x: sessionState.currentX,
      y: sessionState.currentY,
      logMessage: `Server-run request sub=0x03 npcId=${npcId} script=${scriptId} map=${sessionState.currentMapId} pos=${sessionState.currentX},${sessionState.currentY}`,
    };
  }

  if (subtype === SERVER_RUN_MESSAGE_SUBCMD) {
    return {
      kind: 'resolved',
      subtype,
      scriptId: payload.readUInt16LE(3),
      mapId: payload.length >= 7 ? payload.readUInt16LE(5) : 0,
      x: sessionState.currentX,
      y: sessionState.currentY,
      logMessage: `Server-run request sub=0x${SERVER_RUN_MESSAGE_SUBCMD.toString(16)} script=${payload.readUInt16LE(3)} map=${payload.length >= 7 ? payload.readUInt16LE(5) : 0} pos=${sessionState.currentX},${sessionState.currentY}`,
    };
  }

  if (subtype === SERVER_RUN_CONTEXT_SUBCMD) {
    if (payload.length < 9) {
      return {
        kind: 'invalid',
        reason: `Short 0x03f1/0x${SERVER_RUN_CONTEXT_SUBCMD.toString(16)} payload`,
      };
    }
    const mode = payload[3];
    const contextId = payload.readUInt16LE(4);
    const extra = payload[6];
    const scriptId = payload.readUInt16LE(7);
    return {
      kind: 'resolved',
      subtype,
      mode,
      contextId,
      extra,
      scriptId,
      mapId: sessionState.currentMapId,
      x: sessionState.currentX,
      y: sessionState.currentY,
      logMessage: `Server-run request sub=0x${SERVER_RUN_CONTEXT_SUBCMD.toString(16)} mode=${mode} contextId=${contextId} extra=${extra} script=${scriptId} map=${sessionState.currentMapId} pos=${sessionState.currentX},${sessionState.currentY}`,
    };
  }

  if (subtype === SERVER_RUN_REST_SUBCMD) {
    if (payload.length < 7) {
      return {
        kind: 'invalid',
        reason: `Short 0x03f1/0x${SERVER_RUN_REST_SUBCMD.toString(16)} payload`,
      };
    }
    const npcId = payload.readUInt32LE(3);
    return {
      kind: 'direct-rest',
      subtype,
      npcId,
      logMessage: `Server-run request sub=0x${SERVER_RUN_REST_SUBCMD.toString(16)} npcId=${npcId} map=${sessionState.currentMapId} pos=${sessionState.currentX},${sessionState.currentY}`,
    };
  }

  return {
    kind: 'unhandled',
    subtype,
  };
}

function executeServerRunAction(action, handlers) {
  if (action.kind === 'transition') {
    handlers.transitionToScene(action.targetSceneId, action.targetX, action.targetY, action.reason);
    return;
  }

  if (action.kind === 'scriptEvent') {
    if (action.mode === 'deferred') {
      handlers.sendServerRunScriptDeferred(action.scriptId);
      return;
    }
    handlers.sendServerRunScriptImmediate(action.scriptId);
    return;
  }

  if (action.kind === 'dialogue') {
    handlers.sendGameDialogue(
      action.speaker,
      action.message,
      action.subtype,
      action.flags,
      action.extraText
    );
    return;
  }

  if (action.kind === 'rest') {
    handlers.restoreAtInn(action.npcId || 0);
    return;
  }

  handlers.sendServerRunMessage(action.npcId, action.msgId);
}

module.exports = {
  executeServerRunAction,
  parseServerRunRequest,
};
