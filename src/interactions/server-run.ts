'use strict';
export {};

const {
  SERVER_RUN_CONTEXT_SUBCMD,
  SERVER_RUN_MESSAGE_SUBCMD,
  SERVER_RUN_REST_SUBCMD,
} = require('../config');
type UnknownRecord = Record<string, any>;
type SessionStateLike = {
  currentMapId: number;
  currentX: number;
  currentY: number;
};
type ServerRunParser = (payload: Buffer, subtype: number, sessionState: SessionStateLike) => UnknownRecord;

// --- Subtype parser dispatch table ---

function parseNpcInteract(payload: Buffer, subtype: number, sessionState: SessionStateLike) {
  if (payload.length < 9) {
    return { kind: 'invalid', reason: `Short 0x03f1/0x${subtype.toString(16)} payload` };
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
    logMessage: `Server-run request sub=0x${subtype.toString(16)} npcId=${npcId} script=${scriptId} map=${sessionState.currentMapId} pos=${sessionState.currentX},${sessionState.currentY}`,
  };
}

function parseNpcInteractWithMode(payload: Buffer, subtype: number, sessionState: SessionStateLike) {
  if (payload.length < 10) {
    return { kind: 'invalid', reason: 'Short 0x03f1/0x4 payload' };
  }
  const mode = payload[3];
  const npcId = payload.readUInt16LE(4);
  const scriptId = payload.readUInt16LE(8);
  return {
    kind: 'npc-interact',
    subtype,
    mode,
    npcId,
    scriptId,
    mapId: sessionState.currentMapId,
    x: sessionState.currentX,
    y: sessionState.currentY,
    logMessage: `Server-run request sub=0x4 mode=${mode} npcId=${npcId} script=${scriptId} map=${sessionState.currentMapId} pos=${sessionState.currentX},${sessionState.currentY}`,
  };
}

function parseScriptEvent(payload: Buffer, subtype: number, sessionState: SessionStateLike) {
  const scriptId = payload.readUInt16LE(3);
  const mapId = payload.length >= 7 ? payload.readUInt16LE(5) : 0;
  return {
    kind: 'resolved',
    subtype,
    scriptId,
    mapId,
    x: sessionState.currentX,
    y: sessionState.currentY,
    logMessage: `Server-run request sub=0x${subtype.toString(16)} script=${scriptId} map=${mapId} pos=${sessionState.currentX},${sessionState.currentY}`,
  };
}

function parseContextEvent(payload: Buffer, subtype: number, sessionState: SessionStateLike) {
  if (payload.length < 9) {
    return { kind: 'invalid', reason: `Short 0x03f1/0x${subtype.toString(16)} payload` };
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
    logMessage: `Server-run request sub=0x${subtype.toString(16)} mode=${mode} contextId=${contextId} extra=${extra} script=${scriptId} map=${sessionState.currentMapId} pos=${sessionState.currentX},${sessionState.currentY}`,
  };
}

function parseNpcActionRequest(payload: Buffer, subtype: number, sessionState: SessionStateLike) {
  if (payload.length < 7) {
    return { kind: 'invalid', reason: `Short 0x03f1/0x${subtype.toString(16)} payload` };
  }
  const npcId = payload.readUInt32LE(3);
  return {
    kind: 'npc-action',
    subtype,
    npcId,
    mapId: sessionState.currentMapId,
    x: sessionState.currentX,
    y: sessionState.currentY,
    logMessage: `Server-run request sub=0x${subtype.toString(16)} npcId=${npcId} map=${sessionState.currentMapId} pos=${sessionState.currentX},${sessionState.currentY}`,
  };
}

function parseQuestAbandon(payload: Buffer, subtype: number, sessionState: SessionStateLike) {
  const taskId = payload.readUInt16LE(3);
  return {
    kind: 'quest-abandon',
    subtype,
    taskId,
    mapId: sessionState.currentMapId,
    x: sessionState.currentX,
    y: sessionState.currentY,
    logMessage: `Server-run request sub=0x5 taskId=${taskId} map=${sessionState.currentMapId} pos=${sessionState.currentX},${sessionState.currentY}`,
  };
}

const SUBTYPE_PARSERS = new Map<number, ServerRunParser>([
  [0x03, parseNpcInteract],
  [0x08, parseNpcInteract],
  [0x04, parseNpcInteractWithMode],
  [SERVER_RUN_MESSAGE_SUBCMD, parseScriptEvent],
  [SERVER_RUN_CONTEXT_SUBCMD, parseContextEvent],
  [SERVER_RUN_REST_SUBCMD, parseNpcActionRequest],
  [0x05, parseQuestAbandon],
]);

function parseServerRunRequest(payload: Buffer, sessionState: SessionStateLike) {
  if (payload.length < 5) {
    return { kind: 'invalid', reason: 'Short 0x03f1 payload' };
  }

  const subtype = payload[2];
  const parser = SUBTYPE_PARSERS.get(subtype);
  if (parser) {
    return parser(payload, subtype, sessionState);
  }

  return { kind: 'unhandled', subtype };
}

// --- Action execution dispatch table ---

function execTransition(action: UnknownRecord, handlers: UnknownRecord): void {
  handlers.transitionToScene(action.targetSceneId, action.targetX, action.targetY, action.reason);
}

function execScriptEvent(action: UnknownRecord, handlers: UnknownRecord): void {
  if (action.mode === 'deferred') {
    handlers.sendServerRunScriptDeferred(action.scriptId);
  } else {
    handlers.sendServerRunScriptImmediate(action.scriptId);
  }
}

function execDialogue(action: UnknownRecord, handlers: UnknownRecord): void {
  handlers.sendGameDialogue(
    action.speaker,
    action.message,
    action.subtype,
    action.flags,
    action.extraText
  );
}

function execRest(action: UnknownRecord, handlers: UnknownRecord): void {
  handlers.restoreAtInn(action.npcId || 0);
}

const ACTION_EXECUTORS = new Map([
  ['transition', execTransition],
  ['scriptEvent', execScriptEvent],
  ['dialogue', execDialogue],
  ['rest', execRest],
]);

function executeServerRunAction(action: UnknownRecord, handlers: UnknownRecord): void {
  const executor = ACTION_EXECUTORS.get(action.kind);
  if (executor) {
    executor(action, handlers);
    return;
  }
  // Fallback: server-run message
  handlers.sendServerRunMessage(action.npcId, action.msgId);
}

module.exports = {
  executeServerRunAction,
  parseServerRunRequest,
};
