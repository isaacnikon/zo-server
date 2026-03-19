'use strict';
export {};

const { resolveServerRunAction, resolveServerRunActionWithFallback } = require('../scene-runtime');
const { hasNpcShopCatalog } = require('./shop-runtime');

type UnknownRecord = Record<string, any>;

const SHOP_ACTION_SUBTYPE = 0x0f;

function buildPlan(overrides: UnknownRecord = {}): UnknownRecord {
  return {
    action: null,
    fallbackAction: null,
    continueToQuest: false,
    probeNpcAction: false,
    logMessage: null,
    ...overrides,
  };
}

function resolveNpcInteractionPlan(request: UnknownRecord): UnknownRecord {
  if (!request || typeof request !== 'object') {
    return buildPlan();
  }

  if (request.kind === 'npc-action') {
    if ((request.subtype >>> 0) === SHOP_ACTION_SUBTYPE && hasNpcShopCatalog(request.npcId >>> 0)) {
      return buildPlan({
        action: {
          kind: 'openShop',
          npcId: request.npcId >>> 0,
        },
      });
    }

    return buildPlan({
      continueToQuest: true,
      probeNpcAction: true,
      logMessage:
        `Observed npc-action subtype=0x${(request.subtype >>> 0).toString(16)} npcId=${request.npcId >>> 0} map=${request.mapId >>> 0}; no explicit NPC action mapping yet`,
    });
  }

  if (request.kind === 'resolved' || request.kind === 'npc-interact') {
    return buildPlan({
      action: resolveServerRunAction({
        mapId: request.mapId,
        subtype: request.subtype,
        mode: request.mode,
        contextId: request.contextId,
        extra: request.extra,
        scriptId: request.scriptId,
        x: request.x,
        y: request.y,
      }),
      fallbackAction: resolveServerRunActionWithFallback({
        mapId: request.mapId,
        subtype: request.subtype,
        mode: request.mode,
        contextId: request.contextId,
        extra: request.extra,
        scriptId: request.scriptId,
        x: request.x,
        y: request.y,
      }),
      continueToQuest: true,
    });
  }

  return buildPlan();
}

module.exports = {
  resolveNpcInteractionPlan,
};
