type TriggerFilter = {
  npcId?: number;
  subtype?: number;
  scriptId?: number;
  mapId?: number;
  monsterId?: number;
  contextId?: number;
  extra?: number;
  stepStatus?: number;
};

import type { UnknownRecord } from '../utils.js';

function matchesTrigger(filter: TriggerFilter, event: UnknownRecord): boolean {
  for (const [field, expected] of Object.entries(filter)) {
    if (!Number.isInteger(expected)) {
      continue;
    }
    const actual = Number.isFinite(event?.[field]) ? event[field] : 0;
    if ((expected >>> 0) !== (actual >>> 0)) {
      return false;
    }
  }
  return true;
}

export {
  matchesTrigger,
};
