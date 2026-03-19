'use strict';
export {};

const { resolveServerRunAction } = require('../scene-runtime');
const { hasNpcShopCatalog } = require('./shop-runtime');

type UnknownRecord = Record<string, any>;

const SHOP_ACTION_SUBTYPE = 0x0f;

function resolveNpcInteractionAction(request: UnknownRecord): UnknownRecord | null {
  if (!request || typeof request !== 'object') {
    return null;
  }

  if (request.kind === 'npc-action') {
    if ((request.subtype >>> 0) === SHOP_ACTION_SUBTYPE && hasNpcShopCatalog(request.npcId >>> 0)) {
      return {
        kind: 'openShop',
        npcId: request.npcId >>> 0,
      };
    }
    return null;
  }

  if (request.kind === 'resolved' || request.kind === 'npc-interact') {
    return resolveServerRunAction({
      mapId: request.mapId,
      subtype: request.subtype,
      mode: request.mode,
      contextId: request.contextId,
      extra: request.extra,
      scriptId: request.scriptId,
      x: request.x,
      y: request.y,
    });
  }

  return null;
}

module.exports = {
  resolveNpcInteractionAction,
};
