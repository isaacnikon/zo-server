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

function isConstrainedNumber(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function matchesTrigger(filter: TriggerFilter, event: UnknownRecord): boolean {
  for (const [field, expected] of Object.entries(filter)) {
    if (!isConstrainedNumber(expected)) {
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
