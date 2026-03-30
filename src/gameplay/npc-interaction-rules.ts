import { applyEffects } from '../effects/effect-executor.js';
import { getMapEncounterLevelRange, getMapSummary } from '../map-data.js';
import { buildEncounterPoolEntry } from '../roleinfo/index.js';

import type { GameSession, ServerRunRequestData } from '../types.js';

type PositionPoint = {
  x: number;
  y: number;
};

type PositionTagRule =
  | {
      kind: 'bounds';
      points: PositionPoint[];
      field: string;
      insideValue: string;
      outsideValue: string;
    }
  | {
      kind: 'radius';
      centerX: number;
      centerY: number;
      radius: number;
      field: string;
      insideValue: string;
      outsideValue: string;
    };

type TeleportRule = {
  id: string;
  mapId: number;
  npcId: number;
  scriptId: number;
  subcmd?: number;
  targetMapId: number;
  targetX: number;
  targetY: number;
  speaker?: string;
  minLevel?: number;
  minLevelMessage?: string;
  cost?: {
    stat: 'coins' | 'gold' | 'renown';
    amount: number;
    insufficientMessage: string;
  };
};

type CombatRule = {
  id: string;
  mapId: number;
  npcId: number;
  scriptIds: number[];
  probeScriptId?: number;
  subcmd?: number;
  monsterId: number;
  positionTag?: PositionTagRule;
};

type RuleResult = {
  handled: boolean;
  kind?: 'teleport' | 'combat';
  ruleId?: string;
  detail?: string;
};

const TELEPORT_RULES: TeleportRule[] = [
  {
    id: 'maple-spirit-willow-forest',
    mapId: 146,
    npcId: 3218,
    scriptId: 20001,
    targetMapId: 126,
    targetX: 147,
    targetY: 492,
  },
  {
    id: 'lion-captain-pass',
    mapId: 146,
    npcId: 3085,
    scriptId: 3000,
    targetMapId: 134,
    targetX: 67,
    targetY: 20,
    speaker: 'Lion Captain',
    minLevel: 30,
    minLevelMessage: 'You need to be level 30 to pass here.',
  },
  {
    id: 'guide-ghost-willow-forest',
    mapId: 126,
    npcId: 3289,
    scriptId: 20001,
    targetMapId: 126,
    targetX: 229,
    targetY: 57,
  },
  {
    id: 'cluck-bird-willow-forest',
    mapId: 126,
    npcId: 3161,
    scriptId: 20001,
    targetMapId: 126,
    targetX: 20,
    targetY: 480,
  },
  {
    id: 'orchid-temple-return',
    mapId: 163,
    npcId: 3061,
    scriptId: 20001,
    targetMapId: 112,
    targetX: 244,
    targetY: 92,
  },
  {
    id: 'darkness-guard-return',
    mapId: 139,
    npcId: 3292,
    scriptId: 20001,
    targetMapId: 108,
    targetX: 12,
    targetY: 84,
  },
  {
    id: 'receiver-spirit-return',
    mapId: 111,
    npcId: 3279,
    scriptId: 20001,
    targetMapId: 143,
    targetX: 96,
    targetY: 13,
  },
  {
    id: 'chill-pass-frog-teleport',
    mapId: 111,
    npcId: 3123,
    scriptId: 1001,
    targetMapId: 112,
    targetX: 79,
    targetY: 317,
    speaker: 'FrogTeleportor',
    cost: {
      stat: 'coins',
      amount: 500,
      insufficientMessage: 'You need 500 coins to travel to Cloud City.',
    },
  },
  {
    id: 'mirror-lake-spirit-return',
    mapId: 133,
    npcId: 3301,
    scriptId: 20001,
    targetMapId: 147,
    targetX: 87,
    targetY: 19,
  },
  {
    id: 'mirror-lake-spirit-palace',
    mapId: 133,
    npcId: 3301,
    scriptId: 20002,
    targetMapId: 150,
    targetX: 114,
    targetY: 137,
  },
  {
    id: 'blurred-lake-spirit-palace',
    mapId: 147,
    npcId: 3293,
    scriptId: 20001,
    targetMapId: 148,
    targetX: 112,
    targetY: 144,
  },
  {
    id: 'receiver-ghost-mirror-lake',
    mapId: 150,
    npcId: 3297,
    scriptId: 20001,
    targetMapId: 133,
    targetX: 72,
    targetY: 54,
  },
  {
    id: 'longicorn-soldier-somber-aisle',
    mapId: 238,
    npcId: 3372,
    scriptId: 20002,
    targetMapId: 234,
    targetX: 28,
    targetY: 236,
  },
  {
    id: 'beetle-guide-silent-hill',
    mapId: 166,
    npcId: 3529,
    scriptId: 20002,
    targetMapId: 182,
    targetX: 32,
    targetY: 144,
  },
  {
    id: 'frontier-soldier-spring-forest',
    mapId: 171,
    npcId: 3228,
    scriptId: 20001,
    targetMapId: 109,
    targetX: 83,
    targetY: 20,
  },
];

const COMBAT_RULES: CombatRule[] = [
  {
    id: 'crane-pass-guardian',
    mapId: 138,
    npcId: 3229,
    scriptIds: [10001],
    monsterId: 5020,
    positionTag: {
      kind: 'bounds',
      field: 'guardianApproachSide',
      insideValue: 'za2',
      outsideValue: 'crane-pass',
      points: [
        { x: 77, y: 90 },
        { x: 92, y: 74 },
        { x: 83, y: 62 },
        { x: 71, y: 73 },
      ],
    },
  },
  {
    id: 'swan-pass-guardian',
    mapId: 230,
    npcId: 3230,
    scriptIds: [10001],
    monsterId: 5021,
    positionTag: {
      kind: 'radius',
      field: 'guardianApproachSide',
      insideValue: 'za2',
      outsideValue: 'swan-pass',
      centerX: 72,
      centerY: 11,
      radius: 20,
    },
  },
  {
    id: 'lion-captain-fight',
    mapId: 146,
    npcId: 3085,
    scriptIds: [10001, 3001],
    probeScriptId: 3001,
    monsterId: 5072,
  },
];

function isPointInsideBounds(x: number, y: number, points: ReadonlyArray<PositionPoint>): boolean {
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

function isPointWithinRadius(x: number, y: number, centerX: number, centerY: number, radius: number): boolean {
  const dx = x - centerX;
  const dy = y - centerY;
  return (dx * dx) + (dy * dy) <= (radius * radius);
}

function matchesTeleportRule(rule: TeleportRule, session: GameSession, npcId: number, request: ServerRunRequestData): boolean {
  const requestScriptId = Number.isInteger(request.scriptId) ? (request.scriptId! >>> 0) : 0;
  return (
    (request.subcmd >>> 0) === ((rule.subcmd ?? 0x02) >>> 0) &&
    (session.currentMapId >>> 0) === (rule.mapId >>> 0) &&
    (npcId >>> 0) === (rule.npcId >>> 0) &&
    requestScriptId === (rule.scriptId >>> 0)
  );
}

function matchesCombatRule(rule: CombatRule, session: GameSession, npcId: number, request: ServerRunRequestData): boolean {
  const requestScriptId = Number.isInteger(request.scriptId) ? (request.scriptId! >>> 0) : 0;
  return (
    (request.subcmd >>> 0) === ((rule.subcmd ?? 0x02) >>> 0) &&
    (session.currentMapId >>> 0) === (rule.mapId >>> 0) &&
    (npcId >>> 0) === (rule.npcId >>> 0) &&
    rule.scriptIds.some((scriptId) => (scriptId >>> 0) === requestScriptId)
  );
}

function buildPositionTag(rule: PositionTagRule | undefined, session: GameSession): Record<string, string> {
  if (!rule) {
    return {};
  }

  if (rule.kind === 'bounds') {
    return {
      [rule.field]: isPointInsideBounds(session.currentX >>> 0, session.currentY >>> 0, rule.points)
        ? rule.insideValue
        : rule.outsideValue,
    };
  }

  return {
    [rule.field]: isPointWithinRadius(
      session.currentX >>> 0,
      session.currentY >>> 0,
      rule.centerX,
      rule.centerY,
      rule.radius
    )
      ? rule.insideValue
      : rule.outsideValue,
  };
}

function tryHandleTeleportRule(
  session: GameSession,
  npcId: number,
  request: ServerRunRequestData
): RuleResult {
  for (const rule of TELEPORT_RULES) {
    if (!matchesTeleportRule(rule, session, npcId, request)) {
      continue;
    }
    if (typeof session.sendSceneEnter !== 'function') {
      return { handled: false };
    }

    const level = Number.isInteger(session.level) ? (session.level >>> 0) : 1;
    const requiredLevel = Number.isInteger(rule.minLevel) ? (Number(rule.minLevel) >>> 0) : 0;
    if (requiredLevel > 0 && level < requiredLevel) {
      session.sendGameDialogue(rule.speaker || 'Travel', rule.minLevelMessage || `You need to be level ${requiredLevel} to continue.`);
      return {
        handled: true,
        kind: 'teleport',
        ruleId: rule.id,
        detail: `blocked=min-level required=${requiredLevel} actual=${level}`,
      };
    }

    if (rule.cost) {
      const currentValue = Number.isInteger(session[rule.cost.stat]) ? Math.max(0, session[rule.cost.stat]) : 0;
      if (currentValue < (rule.cost.amount >>> 0)) {
        session.sendGameDialogue(rule.speaker || 'Travel', rule.cost.insufficientMessage);
        return {
          handled: true,
          kind: 'teleport',
          ruleId: rule.id,
          detail: `blocked=insufficient-${rule.cost.stat} required=${rule.cost.amount >>> 0} actual=${currentValue}`,
        };
      }

      applyEffects(
        session,
        [{ kind: 'update-stat', stat: rule.cost.stat, delta: -(rule.cost.amount >>> 0) }],
        { suppressDialogues: true, suppressStatSync: true }
      );
    }

    session.sendSceneEnter(rule.targetMapId >>> 0, rule.targetX >>> 0, rule.targetY >>> 0);
    return {
      handled: true,
      kind: 'teleport',
      ruleId: rule.id,
      detail: rule.cost
        ? `cost=${rule.cost.amount >>> 0} ${rule.cost.stat} remaining=${Math.max(0, session[rule.cost.stat] || 0)}`
        : `target=${rule.targetMapId >>> 0}@${rule.targetX >>> 0},${rule.targetY >>> 0}`,
    };
  }

  return { handled: false };
}

function tryHandleCombatRule(
  session: GameSession,
  npcId: number,
  request: ServerRunRequestData
): RuleResult {
  if (typeof session.sendCombatEncounterProbe !== 'function' || session.combatState?.active) {
    return { handled: false };
  }

  for (const rule of COMBAT_RULES) {
    if (!matchesCombatRule(rule, session, npcId, request)) {
      continue;
    }

    const encounterLevelRange = getMapEncounterLevelRange(session.currentMapId);
    const mapName = getMapSummary(session.currentMapId)?.mapName || `Map ${session.currentMapId}`;
    const requestScriptId = Number.isInteger(request.scriptId) ? (request.scriptId! >>> 0) : 0;
    session.sendCombatEncounterProbe({
      probeId: `npc-fight:${rule.npcId >>> 0}:${(rule.probeScriptId ?? requestScriptId) >>> 0}:${Date.now()}`,
      originMapId: session.currentMapId >>> 0,
      originX: session.currentX >>> 0,
      originY: session.currentY >>> 0,
      ...buildPositionTag(rule.positionTag, session),
      encounterProfile: {
        minEnemies: 1,
        maxEnemies: 1,
        locationName: mapName,
        pool: [
          buildEncounterPoolEntry(rule.monsterId, {
            levelMin: encounterLevelRange?.min || 1,
            levelMax: encounterLevelRange?.max || encounterLevelRange?.min || 1,
            weight: 1,
          }),
        ],
      },
    });

    return {
      handled: true,
      kind: 'combat',
      ruleId: rule.id,
      detail: `monsterId=${rule.monsterId >>> 0}`,
    };
  }

  return { handled: false };
}

export function tryHandleConfiguredNpcInteraction(
  session: GameSession,
  npcId: number,
  request: ServerRunRequestData
): RuleResult {
  const teleportResult = tryHandleTeleportRule(session, npcId, request);
  if (teleportResult.handled) {
    return teleportResult;
  }

  return tryHandleCombatRule(session, npcId, request);
}
