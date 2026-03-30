import { DEFAULT_FLAGS, GAME_FIGHT_CLIENT_CMD, FIGHT_CLIENT_PLAYER_VAR_SYNC_SUBCMD } from '../config.js';
import { buildPlayerVarSyncPacket } from '../protocol/gameplay-packets.js';
import { sendSelfStateValueUpdate } from './stat-sync.js';
import type { FrogTeleporterUnlocks, GameSession, ServerRunRequestData } from '../types.js';

const FROG_SPEAKER = 'Frog Teleportor';
const CLOUD_CITY_MAP_ID = 112;
const RAINBOW_VALLEY_MAP_ID = 101;
const CHILL_PASS_MAP_ID = 111;
const GOAL_MANOR_MAP_ID = 131;
const TIMBER_TOWN_MAP_ID = 169;
const ARIEL_MANOR_MAP_ID = 170;
const CELESTIAL_STATE_MAP_ID = 204;
const PLAYER_VAR_TOWN_TRAVEL_INDEX = 3;
const PLAYER_VAR_CHILL_PASS_INDEX = 5;
const PLAYER_VAR_RAINBOW_TO_CLOUD_CITY = 0x4000;
const PLAYER_VAR_GOAL_MANOR = 0x8000;
const PLAYER_VAR_TIMBER_TOWN = 0x2000;
const PLAYER_VAR_CHILL_PASS = 0x0001;
const PLAYER_VAR_ARIEL_MANOR = 0x20000;
const PLAYER_VAR_CELESTIAL_STATE = 0x40000;

type RuleResult = {
  handled: boolean;
  kind?: 'teleport';
  ruleId?: string;
  detail?: string;
};

type FrogTeleportRoute = {
  id: string;
  mapId: number;
  npcId: number;
  scriptId: number;
  targetMapId: number;
  targetX: number;
  targetY: number;
  costCoins: number;
  minLevel?: number;
  minLevelMessage?: string;
  isUnlocked?: (session: GameSession, unlocks: FrogTeleporterUnlocks) => boolean;
  unlockOnUse?: (unlocks: FrogTeleporterUnlocks) => FrogTeleporterUnlocks;
};

export function defaultFrogTeleporterUnlocks(): FrogTeleporterUnlocks {
  return {
    cloudCityToRainbowValley: true,
    cloudCityToGoalManor: false,
    cloudCityToTimberTown: false,
    cloudCityToChillPass: false,
    cloudCityToArielManor: false,
    cloudCityToCelestialState: false,
    rainbowValleyToCloudCity: false,
    goalManorToCloudCity: true,
  };
}

export function normalizeFrogTeleporterUnlocks(value: unknown): FrogTeleporterUnlocks {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const defaults = defaultFrogTeleporterUnlocks();
  return {
    cloudCityToRainbowValley:
      typeof source.cloudCityToRainbowValley === 'boolean'
        ? source.cloudCityToRainbowValley
        : defaults.cloudCityToRainbowValley,
    cloudCityToGoalManor:
      typeof source.cloudCityToGoalManor === 'boolean'
        ? source.cloudCityToGoalManor
        : defaults.cloudCityToGoalManor,
    cloudCityToTimberTown:
      typeof source.cloudCityToTimberTown === 'boolean'
        ? source.cloudCityToTimberTown
        : defaults.cloudCityToTimberTown,
    cloudCityToChillPass:
      typeof source.cloudCityToChillPass === 'boolean'
        ? source.cloudCityToChillPass
        : defaults.cloudCityToChillPass,
    cloudCityToArielManor:
      typeof source.cloudCityToArielManor === 'boolean'
        ? source.cloudCityToArielManor
        : defaults.cloudCityToArielManor,
    cloudCityToCelestialState:
      typeof source.cloudCityToCelestialState === 'boolean'
        ? source.cloudCityToCelestialState
        : defaults.cloudCityToCelestialState,
    rainbowValleyToCloudCity:
      typeof source.rainbowValleyToCloudCity === 'boolean'
        ? source.rainbowValleyToCloudCity
        : defaults.rainbowValleyToCloudCity,
    // Goal Manor -> Cloud City is available by default. Force-enable it so stale
    // saves from the earlier gated implementation recover automatically.
    goalManorToCloudCity: true,
  };
}

export function hydrateFrogTeleporterUnlocks(session: GameSession, value: unknown): void {
  session.frogTeleporterUnlocks = normalizeFrogTeleporterUnlocks(value);
}

function buildFrogTeleporterClientVarWord3(unlocks: FrogTeleporterUnlocks): number {
  let value = 0;
  if (unlocks.rainbowValleyToCloudCity === true) {
    value |= PLAYER_VAR_RAINBOW_TO_CLOUD_CITY;
  }
  if (unlocks.cloudCityToGoalManor === true) {
    value |= PLAYER_VAR_GOAL_MANOR;
  }
  if (unlocks.cloudCityToTimberTown === true) {
    value |= PLAYER_VAR_TIMBER_TOWN;
  }
  if (unlocks.cloudCityToArielManor === true) {
    value |= PLAYER_VAR_ARIEL_MANOR;
  }
  if (unlocks.cloudCityToCelestialState === true) {
    value |= PLAYER_VAR_CELESTIAL_STATE;
  }
  return value >>> 0;
}

function buildFrogTeleporterClientVarWord5(unlocks: FrogTeleporterUnlocks): number {
  return unlocks.cloudCityToChillPass === true ? PLAYER_VAR_CHILL_PASS : 0;
}

function sendPlayerVarSync(session: GameSession, index: number, value: number, reason: string): void {
  session.writePacket(
    buildPlayerVarSyncPacket({ index, value }),
    DEFAULT_FLAGS,
    `Sending frog player-var sync cmd=0x${GAME_FIGHT_CLIENT_CMD.toString(16)} sub=0x${FIGHT_CLIENT_PLAYER_VAR_SYNC_SUBCMD.toString(16)} index=${index} value=0x${(value >>> 0).toString(16)} reason=${reason}`
  );
}

export function syncFrogTeleporterClientState(session: GameSession, reason = 'runtime'): void {
  const unlocks = normalizeFrogTeleporterUnlocks(session.frogTeleporterUnlocks);
  sendPlayerVarSync(
    session,
    PLAYER_VAR_TOWN_TRAVEL_INDEX,
    buildFrogTeleporterClientVarWord3(unlocks),
    reason
  );
  sendPlayerVarSync(
    session,
    PLAYER_VAR_CHILL_PASS_INDEX,
    buildFrogTeleporterClientVarWord5(unlocks),
    reason
  );
}

export function handleFrogTeleporterMapArrival(
  session: GameSession,
  previousMapId: number,
  currentMapId: number
): FrogTeleporterUnlocks | null {
  void session;
  void previousMapId;
  void currentMapId;
  return null;
}

const FROG_TELEPORT_ROUTES: ReadonlyArray<FrogTeleportRoute> = [
  {
    id: 'cloud-city-to-rainbow-valley',
    mapId: CLOUD_CITY_MAP_ID,
    npcId: 3109,
    scriptId: 1016,
    targetMapId: RAINBOW_VALLEY_MAP_ID,
    targetX: 120,
    targetY: 180,
    costCoins: 100,
    isUnlocked: (_session, unlocks) => unlocks.cloudCityToRainbowValley === true,
    unlockOnUse: (unlocks) => ({
      ...unlocks,
      rainbowValleyToCloudCity: true,
    }),
  },
  {
    id: 'cloud-city-to-goal-manor',
    mapId: CLOUD_CITY_MAP_ID,
    npcId: 3109,
    scriptId: 1015,
    targetMapId: GOAL_MANOR_MAP_ID,
    targetX: 77,
    targetY: 71,
    costCoins: 100,
    isUnlocked: (_session, unlocks) => unlocks.cloudCityToGoalManor === true,
  },
  {
    id: 'cloud-city-to-timber-town',
    mapId: CLOUD_CITY_MAP_ID,
    npcId: 3109,
    scriptId: 1004,
    targetMapId: TIMBER_TOWN_MAP_ID,
    targetX: 121,
    targetY: 102,
    costCoins: 1000,
    minLevel: 50,
    minLevelMessage: 'You need to be level 50 to travel to Timber Town.',
    isUnlocked: (_session, unlocks) => unlocks.cloudCityToTimberTown === true,
  },
  {
    id: 'cloud-city-to-chill-pass',
    mapId: CLOUD_CITY_MAP_ID,
    npcId: 3109,
    scriptId: 1001,
    targetMapId: CHILL_PASS_MAP_ID,
    targetX: 126,
    targetY: 377,
    costCoins: 500,
    minLevel: 30,
    minLevelMessage: 'You need to be level 30 to travel to Chill Pass.',
    isUnlocked: (_session, unlocks) => unlocks.cloudCityToChillPass === true,
  },
  {
    id: 'cloud-city-to-ariel-manor',
    mapId: CLOUD_CITY_MAP_ID,
    npcId: 3109,
    scriptId: 2001,
    targetMapId: ARIEL_MANOR_MAP_ID,
    targetX: 84,
    targetY: 126,
    costCoins: 1500,
    minLevel: 75,
    minLevelMessage: 'You need to be level 75 to travel to Ariel Manor.',
    isUnlocked: (_session, unlocks) => unlocks.cloudCityToArielManor === true,
  },
  {
    id: 'cloud-city-to-celestial-state',
    mapId: CLOUD_CITY_MAP_ID,
    npcId: 3109,
    scriptId: 1008,
    targetMapId: CELESTIAL_STATE_MAP_ID,
    targetX: 54,
    targetY: 192,
    costCoins: 2000,
    minLevel: 90,
    minLevelMessage: 'You need to be level 90 to travel to Celestial State.',
    isUnlocked: (_session, unlocks) => unlocks.cloudCityToCelestialState === true,
  },
  {
    id: 'rainbow-valley-to-cloud-city',
    mapId: RAINBOW_VALLEY_MAP_ID,
    npcId: 3217,
    scriptId: 1011,
    targetMapId: CLOUD_CITY_MAP_ID,
    targetX: 79,
    targetY: 317,
    costCoins: 500,
    isUnlocked: (_session, unlocks) => unlocks.rainbowValleyToCloudCity === true,
  },
  {
    id: 'goal-manor-to-cloud-city',
    mapId: GOAL_MANOR_MAP_ID,
    npcId: 3216,
    scriptId: 1011,
    targetMapId: CLOUD_CITY_MAP_ID,
    targetX: 79,
    targetY: 317,
    costCoins: 100,
    isUnlocked: (_session, unlocks) => unlocks.goalManorToCloudCity === true,
    unlockOnUse: (unlocks) => ({
      ...unlocks,
      cloudCityToGoalManor: true,
    }),
  },
  {
    id: 'timber-town-to-cloud-city',
    mapId: TIMBER_TOWN_MAP_ID,
    npcId: 3107,
    scriptId: 1001,
    targetMapId: CLOUD_CITY_MAP_ID,
    targetX: 79,
    targetY: 317,
    costCoins: 1000,
    minLevel: 50,
    minLevelMessage: 'You need to be level 50 to travel to Cloud City.',
    unlockOnUse: (unlocks) => ({
      ...unlocks,
      cloudCityToTimberTown: true,
    }),
  },
  {
    id: 'chill-pass-to-cloud-city',
    mapId: CHILL_PASS_MAP_ID,
    npcId: 3123,
    scriptId: 1001,
    targetMapId: CLOUD_CITY_MAP_ID,
    targetX: 79,
    targetY: 317,
    costCoins: 500,
    minLevel: 30,
    minLevelMessage: 'You need to be level 30 to travel to Cloud City.',
    unlockOnUse: (unlocks) => ({
      ...unlocks,
      cloudCityToChillPass: true,
    }),
  },
  {
    id: 'ariel-manor-to-cloud-city',
    mapId: ARIEL_MANOR_MAP_ID,
    npcId: 3649,
    scriptId: 1000,
    targetMapId: CLOUD_CITY_MAP_ID,
    targetX: 79,
    targetY: 317,
    costCoins: 1500,
    minLevel: 75,
    minLevelMessage: 'You need to be level 75 to travel to Cloud City.',
    unlockOnUse: (unlocks) => ({
      ...unlocks,
      cloudCityToArielManor: true,
    }),
  },
  {
    id: 'celestial-state-to-cloud-city',
    mapId: CELESTIAL_STATE_MAP_ID,
    npcId: 3753,
    scriptId: 1000,
    targetMapId: CLOUD_CITY_MAP_ID,
    targetX: 79,
    targetY: 317,
    costCoins: 2000,
    minLevel: 90,
    minLevelMessage: 'You need to be level 90 to travel to Cloud City.',
    unlockOnUse: (unlocks) => ({
      ...unlocks,
      cloudCityToCelestialState: true,
    }),
  },
];

const FROG_TELEPORT_NPC_IDS = new Set<number>(
  FROG_TELEPORT_ROUTES.map((route) => route.npcId >>> 0)
);

export function isFrogTeleporterNpc(npcId: number): boolean {
  return FROG_TELEPORT_NPC_IDS.has(npcId >>> 0);
}

export function tryHandleFrogTeleporterInteraction(
  session: GameSession,
  npcId: number,
  request: ServerRunRequestData
): RuleResult {
  const requestScriptId = Number.isInteger(request.scriptId) ? (request.scriptId! >>> 0) : 0;
  const currentMapId = Number.isInteger(session.currentMapId) ? (session.currentMapId >>> 0) : 0;
  const unlocks = normalizeFrogTeleporterUnlocks(session.frogTeleporterUnlocks);

  for (const route of FROG_TELEPORT_ROUTES) {
    if (
      (request.subcmd >>> 0) !== 0x02 ||
      currentMapId !== (route.mapId >>> 0) ||
      (npcId >>> 0) !== (route.npcId >>> 0) ||
      requestScriptId !== (route.scriptId >>> 0)
    ) {
      continue;
    }

    if (route.isUnlocked && route.isUnlocked(session, unlocks) !== true) {
      const blockedMessage =
        route.id === 'goal-manor-to-cloud-city'
          ? 'Please go to the Frog Teleportor in Cloud City to open this service first.'
          : 'This route is not available yet.';
      session.sendGameDialogue(FROG_SPEAKER, blockedMessage);
      return {
        handled: true,
        kind: 'teleport',
        ruleId: route.id,
        detail: 'blocked=route-locked',
      };
    }

    const level = Number.isInteger(session.level) ? (session.level >>> 0) : 1;
    const minLevel = Number.isInteger(route.minLevel) ? (route.minLevel! >>> 0) : 0;
    if (minLevel > 0 && level < minLevel) {
      session.sendGameDialogue(
        FROG_SPEAKER,
        route.minLevelMessage || `You need to be level ${minLevel} to travel.`
      );
      return {
        handled: true,
        kind: 'teleport',
        ruleId: route.id,
        detail: `blocked=min-level required=${minLevel} actual=${level}`,
      };
    }

    const currentCoins = Number.isInteger(session.coins) ? Math.max(0, session.coins) : 0;
    if (currentCoins < (route.costCoins >>> 0)) {
      session.sendGameDialogue(
        FROG_SPEAKER,
        `You need ${route.costCoins >>> 0} coins to travel there.`
      );
      return {
        handled: true,
        kind: 'teleport',
        ruleId: route.id,
        detail: `blocked=insufficient-coins required=${route.costCoins >>> 0} actual=${currentCoins}`,
      };
    }

    session.coins = Math.max(0, currentCoins - (route.costCoins >>> 0));
    sendSelfStateValueUpdate(session, 'coins', session.coins >>> 0);

    const updatedUnlocks = route.unlockOnUse ? normalizeFrogTeleporterUnlocks(route.unlockOnUse(unlocks)) : unlocks;
    session.frogTeleporterUnlocks = updatedUnlocks;
    syncFrogTeleporterClientState(session, `frog-route-${route.id}`);
    session.persistCurrentCharacter({
      coins: session.coins >>> 0,
      frogTeleporterUnlocks: updatedUnlocks,
    });
    session.sendSceneEnter(route.targetMapId >>> 0, route.targetX >>> 0, route.targetY >>> 0);
    return {
      handled: true,
      kind: 'teleport',
      ruleId: route.id,
      detail: `cost=${route.costCoins >>> 0} coins remaining=${session.coins >>> 0}`,
    };
  }

  return { handled: false };
}
