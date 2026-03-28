import fs from 'node:fs';
import { DEFAULT_FLAGS, GAME_NPC_SHOP_CMD } from '../config.js';
import { getMapEncounterLevelRange, getMapNpcs, getMapSummary } from '../map-data.js';
import { getBagQuantityByTemplateId } from '../inventory/index.js';
import { getCurrentObjective, getCurrentStep, getCurrentStepUi, interactWithNpc, getQuestDefinition, getQuestAcceptBlocker, } from '../quest-engine/index.js';
import { buildNpcShopOpenPacket } from '../protocol/gameplay-packets.js';
import { resolveRepoPath } from '../runtime-paths.js';
import { recomputeSessionMaxVitals, resolveInnRestVitals } from '../gameplay/session-flows.js';
import { primeNpcServiceContext } from '../gameplay/npc-service-runtime.js';
import { sendSelfStateValueUpdate, sendSelfStateVitalsUpdate } from '../gameplay/stat-sync.js';
import { buildEncounterPoolEntry } from '../roleinfo/index.js';
import { grantSkill, sendSkillStateSync } from '../gameplay/skill-runtime.js';
import { applyEffects } from '../effects/effect-executor.js';
import { matchesTrigger } from '../triggers/trigger-matcher.js';
import { applyQuestEvents } from './quest-handler.js';
function isPointInsideBounds(x, y, points) {
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
}
function isPointWithinRadius(x, y, centerX, centerY, radius) {
    const dx = x - centerX;
    const dy = y - centerY;
    return (dx * dx) + (dy * dy) <= (radius * radius);
}
const NPC_SHOP_REGISTRY_FILE = resolveRepoPath('data', 'client-derived', 'npc-shops.json');
const NPC_SHOP_REGISTRY = loadNpcShopRegistry();
const INN_REST_SCRIPT_ID = 5001;
const ORCHID_TEMPLE_FREE_SOUL_NPC_ID = 3061;
const ORCHID_TEMPLE_RETURN_SCRIPT_ID = 20001;
const ORCHID_TEMPLE_MAP_ID = 163;
const CLOUD_CITY_MAP_ID = 112;
const CLOUD_CITY_RETURN_X = 244;
const CLOUD_CITY_RETURN_Y = 92;
const DARKNESS_HAMLET_MAP_ID = 139;
const DARKNESS_GUARD_NPC_ID = 3292;
const DARKNESS_GUARD_RETURN_SCRIPT_ID = 20001;
const GOLDEN_PATH_MAP_ID = 108;
const GOLDEN_PATH_RETURN_X = 12;
const GOLDEN_PATH_RETURN_Y = 84;
const CRANE_PASS_MAP_ID = 138;
const CRANE_PASS_GUARDIAN_NPC_ID = 3229;
const CRANE_PASS_GUARDIAN_SCRIPT_ID = 10001;
const CRANE_PASS_GUARDIAN_MONSTER_ID = 5020;
const CRANE_PASS_ZA2_APPROACH_POLYGON = [
    { x: 77, y: 90 },
    { x: 92, y: 74 },
    { x: 83, y: 62 },
    { x: 71, y: 73 },
];
const SWAN_PASS_MAP_ID = 230;
const SWAN_PASS_GUARDIAN_NPC_ID = 3230;
const SWAN_PASS_GUARDIAN_SCRIPT_ID = 10001;
const SWAN_PASS_GUARDIAN_MONSTER_ID = 5021;
const SWAN_PASS_ZA2_APPROACH_X = 72;
const SWAN_PASS_ZA2_APPROACH_Y = 11;
const SWAN_PASS_ZA2_APPROACH_RADIUS = 20;
const MAPLE_VALLEY_MAP_ID = 146;
const LION_CAPTAIN_NPC_ID = 3085;
const LION_CAPTAIN_ROOT_SCRIPT_ID = 10001;
const LION_CAPTAIN_PASS_SCRIPT_ID = 3000;
const LION_CAPTAIN_FIGHT_SCRIPT_ID = 3001;
const LION_CAPTAIN_MONSTER_ID = 5072;
const LION_CAPTAIN_PASS_MIN_LEVEL = 30;
const TRIDENT_MOUNTAIN_MAP_ID = 134;
const TRIDENT_MOUNTAIN_ENTRY_X = 67;
const TRIDENT_MOUNTAIN_ENTRY_Y = 20;
const CHILL_PASS_MAP_ID = 111;
const CHILL_PASS_FROG_TELEPORTOR_NPC_ID = 3123;
const CHILL_PASS_FROG_TELEPORT_SCRIPT_ID = 1001;
const CHILL_PASS_FROG_TELEPORT_PRICE = 500;
const RECEIVER_SPIRIT_NPC_ID = 3279;
const RECEIVER_SPIRIT_RETURN_SCRIPT_ID = 20001;
const CLOUD_CITY_FROG_TELEPORT_ENTRY_X = 79;
const CLOUD_CITY_FROG_TELEPORT_ENTRY_Y = 317;
const BENTHAL_PATH_MAP_ID = 143;
const BENTHAL_PATH_ENTRY_X = 96;
const BENTHAL_PATH_ENTRY_Y = 13;
const MIRROR_LAKE_MAP_ID = 133;
const MIRROR_LAKE_SPIRIT_NPC_ID = 3301;
const MIRROR_LAKE_SPIRIT_RETURN_SCRIPT_ID = 20001;
const MIRROR_LAKE_SPIRIT_PALACE_SCRIPT_ID = 20002;
const MIRROR_PALACE_ENTRY_X = 114;
const MIRROR_PALACE_ENTRY_Y = 137;
const BLURRED_LAKE_MAP_ID = 147;
const BLURRED_LAKE_ENTRY_X = 87;
const BLURRED_LAKE_ENTRY_Y = 19;
const BLURRED_LAKE_SPIRIT_NPC_ID = 3293;
const BLURRED_LAKE_SPIRIT_PALACE_SCRIPT_ID = 20001;
const DEEP_CORRIDOR_MAP_ID = 148;
const DEEP_CORRIDOR_ENTRY_X = 112;
const DEEP_CORRIDOR_ENTRY_Y = 144;
const MIRROR_PALACE_MAP_ID = 150;
const RECEIVER_GHOST_NPC_ID = 3297;
const RECEIVER_GHOST_MIRROR_LAKE_SCRIPT_ID = 20001;
const MIRROR_LAKE_RETURN_X = 72;
const MIRROR_LAKE_RETURN_Y = 54;
const LONGICORN_HOLE_MAP_ID = 238;
const LONGICORN_SOLDIER_NPC_ID = 3372;
const LONGICORN_SOLDIER_SOMBER_AISLE_SCRIPT_ID = 20002;
const SOMBER_AISLE_MAP_ID = 234;
const SOMBER_AISLE_ENTRY_X = 28;
const SOMBER_AISLE_ENTRY_Y = 236;
const CHAIN_PEAK_MAP_ID = 166;
const BEETLE_GUIDE_NPC_ID = 3529;
const BEETLE_GUIDE_SILENT_HILL_SCRIPT_ID = 20002;
const SILENT_HILL_MAP_ID = 182;
const SILENT_HILL_ENTRY_X = 32;
const SILENT_HILL_ENTRY_Y = 144;
const ZIG_PASS_MAP_ID = 171;
const FRONTIER_SOLDIER_NPC_ID = 3228;
const FRONTIER_SOLDIER_RETURN_SCRIPT_ID = 20001;
const SPRING_FOREST_MAP_ID = 109;
const SPRING_FOREST_ENTRY_X = 83;
const SPRING_FOREST_ENTRY_Y = 20;
const HOUSEWIFE_NPC_ID = 3089;
const HOUSEWIFE_LIFE_SKILL_IDS = [9001, 9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009];
const HOUSEWIFE_LIFE_SKILL_NAMES = {
    9001: 'Compose',
    9002: 'Cooking',
    9003: 'Decompose',
    9004: 'Gem Machining',
    9005: 'Alchemy',
    9006: 'Mining',
    9007: 'Lumbering',
    9008: 'Herbalism',
    9009: 'Fishing',
};
function handleNpcInteractionRequest(session, request) {
    if (request.subcmd !== 0x02 &&
        request.subcmd !== 0x03 &&
        request.subcmd !== 0x04 &&
        request.subcmd !== 0x08 &&
        request.subcmd !== 0x0f) {
        return false;
    }
    const npc = resolveNpcInteractionTarget(session, request);
    const npcRecordId = typeof npc?.npcId === 'number' && Number.isInteger(npc.npcId) ? (npc.npcId >>> 0) : 0;
    const npcEntityType = typeof npc?.resolvedSpawnEntityType === 'number' && Number.isInteger(npc.resolvedSpawnEntityType)
        ? (npc.resolvedSpawnEntityType >>> 0)
        : 0;
    const requestNpcId = typeof request.npcId === 'number' && Number.isInteger(request.npcId) ? (request.npcId >>> 0) : 0;
    const resolvedNpcId = (typeof npc?.validationStatus === 'string' && npc.validationStatus === 'alias-id-mismatch'
        ? npcRecordId
        : 0) ||
        npcEntityType ||
        npcRecordId ||
        requestNpcId ||
        0;
    if (resolvedNpcId <= 0) {
        return false;
    }
    if (handleInnRestRequest(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId}`);
        return true;
    }
    if (handleChillPassFrogTeleportorRequest(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} frogTeleportor=1`);
        return true;
    }
    if (handleHousewifeTeachingRequest(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} housewife=1`);
        return true;
    }
    if (handleOrchidTempleReturnRequest(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} orchidTempleReturn=1`);
        return true;
    }
    if (handleDarknessGuardReturnRequest(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} darknessGuardReturn=1`);
        return true;
    }
    if (handleReceiverSpiritReturnRequest(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} receiverSpiritReturn=1`);
        return true;
    }
    if (handleMirrorLakeSpiritReturnRequest(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} mirrorLakeSpiritReturn=1`);
        return true;
    }
    if (handleMirrorLakeSpiritPalaceRequest(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} mirrorLakeSpiritPalace=1`);
        return true;
    }
    if (handleBlurredLakeSpiritPalaceRequest(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} blurredLakeSpiritPalace=1`);
        return true;
    }
    if (handleReceiverGhostMirrorLakeRequest(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} receiverGhostMirrorLake=1`);
        return true;
    }
    if (handleLongicornSoldierSomberAisleRequest(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} longicornSoldierSomberAisle=1`);
        return true;
    }
    if (handleBeetleGuideSilentHillRequest(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} beetleGuideSilentHill=1`);
        return true;
    }
    if (handleFrontierSoldierSpringForestRequest(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} frontierSoldierReturn=1`);
        return true;
    }
    if (tryStartCranePassGuardianNpcCombat(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} npcCombat=1`);
        return true;
    }
    if (tryStartSwanPassGuardianNpcCombat(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} npcCombat=1`);
        return true;
    }
    if (tryStartLionCaptainNpcCombat(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} npcCombat=1`);
        return true;
    }
    if (handleLionCaptainPassRequest(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} lionCaptainPass=1`);
        return true;
    }
    if (request.subcmd === 0x0f) {
        primeNpcServiceContext(session, resolvedNpcId, Number.isInteger(request.rawArgs?.[0]) ? (request.rawArgs[0] >>> 0) : 0);
        sendNpcShopOpen(session, resolvedNpcId, request);
    }
    let handledQuestEvents = false;
    if (request.subcmd === 0x02 || request.subcmd === 0x03 || request.subcmd === 0x04 || request.subcmd === 0x08) {
        const questState = {
            activeQuests: session.activeQuests,
            completedQuests: session.completedQuests,
            level: session.level,
        };
        const auxiliaryResult = applyQuestNpcAuxiliaryActions(session, questState, resolvedNpcId, request);
        const events = interactWithNpc(questState, resolvedNpcId, (templateId) => getBagQuantityByTemplateId(session, templateId), (item) => countMatchingQuestItems(session, item));
        const combinedEvents = auxiliaryResult && auxiliaryResult.events.length > 0 ? [...auxiliaryResult.events, ...events] : events;
        session.activeQuests = questState.activeQuests;
        session.completedQuests = questState.completedQuests;
        if (combinedEvents.length > 0) {
            handledQuestEvents = true;
            applyQuestEvents(session, combinedEvents, auxiliaryResult ? 'npc-talk-aux' : 'npc-talk', {
                selectedAwardId: Number.isInteger(request.awardId) ? (request.awardId >>> 0) : 0,
            });
        }
        else if (auxiliaryResult?.stateChanged === true) {
            session.persistCurrentCharacter?.();
        }
        else {
            const blocker = getQuestAcceptBlocker(questState, resolvedNpcId);
            if (blocker) {
                session.sendGameDialogue('Quest', blocker);
            }
        }
        if (auxiliaryResult?.combatTrigger &&
            typeof session.sendCombatEncounterProbe === 'function' &&
            !session.combatState?.active) {
            const encounterLevelRange = getMapEncounterLevelRange(session.currentMapId);
            const mapName = getMapSummary(session.currentMapId)?.mapName || `Map ${session.currentMapId}`;
            session.sendCombatEncounterProbe({
                probeId: `quest-aux:${auxiliaryResult.combatTrigger.taskId}:${auxiliaryResult.combatTrigger.monsterId}:${Date.now()}`,
                encounterProfile: {
                    minEnemies: Math.max(1, auxiliaryResult.combatTrigger.count || 1),
                    maxEnemies: Math.max(1, auxiliaryResult.combatTrigger.count || 1),
                    locationName: mapName,
                    pool: [
                        buildEncounterPoolEntry(auxiliaryResult.combatTrigger.monsterId, {
                            levelMin: encounterLevelRange?.min || 1,
                            levelMax: encounterLevelRange?.max || encounterLevelRange?.min || 1,
                            weight: 1,
                        }),
                    ],
                },
            });
            session.log(`NPC interaction auxiliary combat taskId=${auxiliaryResult.combatTrigger.taskId} monsterId=${auxiliaryResult.combatTrigger.monsterId} count=${auxiliaryResult.combatTrigger.count} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId}`);
            return true;
        }
    }
    if (handledQuestEvents !== true &&
        tryStartQuestKillCombat(session, resolvedNpcId, request)) {
        session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} questCombat=1`);
        return true;
    }
    if (handledQuestEvents !== true &&
        (request.subcmd === 0x02 || request.subcmd === 0x03 || request.subcmd === 0x04) &&
        Number.isInteger(request.scriptId) &&
        typeof session.sendServerRunScriptImmediate === 'function') {
        session.sendServerRunScriptImmediate(request.scriptId >>> 0);
    }
    session.log(`NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId}`);
    return true;
}
function tryStartQuestKillCombat(session, npcId, request) {
    if (request.subcmd !== 0x02 || typeof session.sendCombatEncounterProbe !== 'function') {
        return false;
    }
    if (session.combatState?.active) {
        return false;
    }
    const activeQuests = Array.isArray(session.activeQuests) ? session.activeQuests : [];
    for (const record of activeQuests) {
        const taskId = Number.isInteger(record?.id) ? (record.id >>> 0) : 0;
        const stepIndex = Number.isInteger(record?.stepIndex) ? (record.stepIndex >>> 0) : 0;
        if (taskId <= 0) {
            continue;
        }
        const definition = getQuestDefinition(taskId);
        const recordForStep = { ...record, stepIndex };
        const step = getCurrentStep(definition, recordForStep);
        const ui = getCurrentStepUi(definition, recordForStep);
        const objective = getCurrentObjective(definition, recordForStep);
        const targetNpcId = Number.isInteger(objective?.targetNpcId) ? (objective.targetNpcId >>> 0) : 0;
        const uiNpcId = Number.isInteger(ui?.overNpcId) ? (ui.overNpcId >>> 0) : 0;
        const handInNpcId = Number.isInteger(objective?.handInNpcId) ? (objective.handInNpcId >>> 0) : 0;
        const stepNpcId = targetNpcId || uiNpcId || handInNpcId || 0;
        const monsterId = Number.isInteger(objective?.targetMonsterId) ? (objective.targetMonsterId >>> 0) : 0;
        const isCombatObjective = objective?.triggerEvent === 'monster-defeat' &&
            (objective?.kind === 'monster-defeat' || objective?.kind === 'item-collect');
        if (!step || !isCombatObjective || stepNpcId !== (npcId >>> 0) || monsterId <= 0) {
            continue;
        }
        const encounterLevelRange = getMapEncounterLevelRange(session.currentMapId);
        const mapName = getMapSummary(session.currentMapId)?.mapName || `Map ${session.currentMapId}`;
        session.sendCombatEncounterProbe({
            probeId: `quest-kill:${taskId}:${monsterId}:${Date.now()}`,
            encounterProfile: {
                minEnemies: 1,
                maxEnemies: 1,
                locationName: mapName,
                pool: [
                    buildEncounterPoolEntry(monsterId, {
                        levelMin: encounterLevelRange?.min || 1,
                        levelMax: encounterLevelRange?.max || encounterLevelRange?.min || 1,
                        weight: 1,
                    }),
                ],
            },
        });
        return true;
    }
    return false;
}
function tryStartCranePassGuardianNpcCombat(session, npcId, request) {
    if (request.subcmd !== 0x02 || typeof session.sendCombatEncounterProbe !== 'function') {
        return false;
    }
    if (session.combatState?.active) {
        return false;
    }
    if ((session.currentMapId >>> 0) !== CRANE_PASS_MAP_ID) {
        return false;
    }
    if ((npcId >>> 0) !== CRANE_PASS_GUARDIAN_NPC_ID) {
        return false;
    }
    const scriptId = Number.isInteger(request.scriptId) ? (request.scriptId >>> 0) : 0;
    if (scriptId !== CRANE_PASS_GUARDIAN_SCRIPT_ID) {
        return false;
    }
    const encounterLevelRange = getMapEncounterLevelRange(session.currentMapId);
    const mapName = getMapSummary(session.currentMapId)?.mapName || `Map ${session.currentMapId}`;
    session.sendCombatEncounterProbe({
        probeId: `npc-fight:${CRANE_PASS_GUARDIAN_NPC_ID}:${CRANE_PASS_GUARDIAN_SCRIPT_ID}:${Date.now()}`,
        originMapId: session.currentMapId >>> 0,
        originX: session.currentX >>> 0,
        originY: session.currentY >>> 0,
        guardianApproachSide: isPointInsideBounds(session.currentX >>> 0, session.currentY >>> 0, CRANE_PASS_ZA2_APPROACH_POLYGON)
            ? 'za2'
            : 'crane-pass',
        encounterProfile: {
            minEnemies: 1,
            maxEnemies: 1,
            locationName: mapName,
            pool: [
                buildEncounterPoolEntry(CRANE_PASS_GUARDIAN_MONSTER_ID, {
                    levelMin: encounterLevelRange?.min || 1,
                    levelMax: encounterLevelRange?.max || encounterLevelRange?.min || 1,
                    weight: 1,
                }),
            ],
        },
    });
    return true;
}
function tryStartSwanPassGuardianNpcCombat(session, npcId, request) {
    if (request.subcmd !== 0x02 || typeof session.sendCombatEncounterProbe !== 'function') {
        return false;
    }
    if (session.combatState?.active) {
        return false;
    }
    if ((session.currentMapId >>> 0) !== SWAN_PASS_MAP_ID) {
        return false;
    }
    if ((npcId >>> 0) !== SWAN_PASS_GUARDIAN_NPC_ID) {
        return false;
    }
    const scriptId = Number.isInteger(request.scriptId) ? (request.scriptId >>> 0) : 0;
    if (scriptId !== SWAN_PASS_GUARDIAN_SCRIPT_ID) {
        return false;
    }
    const encounterLevelRange = getMapEncounterLevelRange(session.currentMapId);
    const mapName = getMapSummary(session.currentMapId)?.mapName || `Map ${session.currentMapId}`;
    session.sendCombatEncounterProbe({
        probeId: `npc-fight:${SWAN_PASS_GUARDIAN_NPC_ID}:${SWAN_PASS_GUARDIAN_SCRIPT_ID}:${Date.now()}`,
        originMapId: session.currentMapId >>> 0,
        originX: session.currentX >>> 0,
        originY: session.currentY >>> 0,
        guardianApproachSide: isPointWithinRadius(session.currentX >>> 0, session.currentY >>> 0, SWAN_PASS_ZA2_APPROACH_X, SWAN_PASS_ZA2_APPROACH_Y, SWAN_PASS_ZA2_APPROACH_RADIUS)
            ? 'za2'
            : 'swan-pass',
        encounterProfile: {
            minEnemies: 1,
            maxEnemies: 1,
            locationName: mapName,
            pool: [
                buildEncounterPoolEntry(SWAN_PASS_GUARDIAN_MONSTER_ID, {
                    levelMin: encounterLevelRange?.min || 1,
                    levelMax: encounterLevelRange?.max || encounterLevelRange?.min || 1,
                    weight: 1,
                }),
            ],
        },
    });
    return true;
}
function tryStartLionCaptainNpcCombat(session, npcId, request) {
    if (request.subcmd !== 0x02 || typeof session.sendCombatEncounterProbe !== 'function') {
        return false;
    }
    if (session.combatState?.active) {
        return false;
    }
    if ((session.currentMapId >>> 0) !== MAPLE_VALLEY_MAP_ID) {
        return false;
    }
    if ((npcId >>> 0) !== LION_CAPTAIN_NPC_ID) {
        return false;
    }
    const scriptId = Number.isInteger(request.scriptId) ? (request.scriptId >>> 0) : 0;
    if (scriptId !== LION_CAPTAIN_ROOT_SCRIPT_ID && scriptId !== LION_CAPTAIN_FIGHT_SCRIPT_ID) {
        return false;
    }
    const encounterLevelRange = getMapEncounterLevelRange(session.currentMapId);
    const mapName = getMapSummary(session.currentMapId)?.mapName || `Map ${session.currentMapId}`;
    session.sendCombatEncounterProbe({
        probeId: `npc-fight:${LION_CAPTAIN_NPC_ID}:${LION_CAPTAIN_FIGHT_SCRIPT_ID}:${Date.now()}`,
        originMapId: session.currentMapId >>> 0,
        originX: session.currentX >>> 0,
        originY: session.currentY >>> 0,
        encounterProfile: {
            minEnemies: 1,
            maxEnemies: 1,
            locationName: mapName,
            pool: [
                buildEncounterPoolEntry(LION_CAPTAIN_MONSTER_ID, {
                    levelMin: encounterLevelRange?.min || 1,
                    levelMax: encounterLevelRange?.max || encounterLevelRange?.min || 1,
                    weight: 1,
                }),
            ],
        },
    });
    return true;
}
function handleLionCaptainPassRequest(session, resolvedNpcId, request) {
    if (request.subcmd !== 0x02 || session.currentMapId !== MAPLE_VALLEY_MAP_ID) {
        return false;
    }
    if (resolvedNpcId !== LION_CAPTAIN_NPC_ID) {
        return false;
    }
    const scriptId = Number.isInteger(request.scriptId) ? (request.scriptId >>> 0) : 0;
    if (scriptId !== LION_CAPTAIN_PASS_SCRIPT_ID) {
        return false;
    }
    const level = Number.isInteger(session.level) ? (session.level >>> 0) : 1;
    if (level < LION_CAPTAIN_PASS_MIN_LEVEL) {
        session.sendGameDialogue('Lion Captain', `You need to be level ${LION_CAPTAIN_PASS_MIN_LEVEL} to pass here.`);
        return true;
    }
    if (typeof session.sendSceneEnter !== 'function') {
        return false;
    }
    session.log(`Sending Lion Captain pass scene-enter map=${TRIDENT_MOUNTAIN_MAP_ID} pos=${TRIDENT_MOUNTAIN_ENTRY_X},${TRIDENT_MOUNTAIN_ENTRY_Y} level=${level}`);
    session.sendSceneEnter(TRIDENT_MOUNTAIN_MAP_ID, TRIDENT_MOUNTAIN_ENTRY_X, TRIDENT_MOUNTAIN_ENTRY_Y);
    return true;
}
function handleOrchidTempleReturnRequest(session, resolvedNpcId, request) {
    if (request.subcmd !== 0x02 || session.currentMapId !== ORCHID_TEMPLE_MAP_ID) {
        return false;
    }
    if (resolvedNpcId !== ORCHID_TEMPLE_FREE_SOUL_NPC_ID) {
        return false;
    }
    const scriptId = Number.isInteger(request.scriptId) ? (request.scriptId >>> 0) : 0;
    if (scriptId !== ORCHID_TEMPLE_RETURN_SCRIPT_ID) {
        return false;
    }
    if (typeof session.sendSceneEnter !== 'function') {
        return false;
    }
    session.log(`Sending Orchid Temple return scene-enter map=${CLOUD_CITY_MAP_ID} pos=${CLOUD_CITY_RETURN_X},${CLOUD_CITY_RETURN_Y}`);
    session.sendSceneEnter(CLOUD_CITY_MAP_ID, CLOUD_CITY_RETURN_X, CLOUD_CITY_RETURN_Y);
    return true;
}
function handleDarknessGuardReturnRequest(session, resolvedNpcId, request) {
    if (request.subcmd !== 0x02 || session.currentMapId !== DARKNESS_HAMLET_MAP_ID) {
        return false;
    }
    if (resolvedNpcId !== DARKNESS_GUARD_NPC_ID) {
        return false;
    }
    const scriptId = Number.isInteger(request.scriptId) ? (request.scriptId >>> 0) : 0;
    if (scriptId !== DARKNESS_GUARD_RETURN_SCRIPT_ID) {
        return false;
    }
    if (typeof session.sendSceneEnter !== 'function') {
        return false;
    }
    session.log(`Sending Darkness Guard return scene-enter map=${GOLDEN_PATH_MAP_ID} pos=${GOLDEN_PATH_RETURN_X},${GOLDEN_PATH_RETURN_Y}`);
    session.sendSceneEnter(GOLDEN_PATH_MAP_ID, GOLDEN_PATH_RETURN_X, GOLDEN_PATH_RETURN_Y);
    return true;
}
function handleReceiverSpiritReturnRequest(session, resolvedNpcId, request) {
    if (request.subcmd !== 0x02 || session.currentMapId !== CHILL_PASS_MAP_ID) {
        return false;
    }
    if (resolvedNpcId !== RECEIVER_SPIRIT_NPC_ID) {
        return false;
    }
    const scriptId = Number.isInteger(request.scriptId) ? (request.scriptId >>> 0) : 0;
    if (scriptId !== RECEIVER_SPIRIT_RETURN_SCRIPT_ID) {
        return false;
    }
    if (typeof session.sendSceneEnter !== 'function') {
        return false;
    }
    session.log(`Sending ReceiverSpirit return scene-enter map=${BENTHAL_PATH_MAP_ID} pos=${BENTHAL_PATH_ENTRY_X},${BENTHAL_PATH_ENTRY_Y}`);
    session.sendSceneEnter(BENTHAL_PATH_MAP_ID, BENTHAL_PATH_ENTRY_X, BENTHAL_PATH_ENTRY_Y);
    return true;
}
function handleChillPassFrogTeleportorRequest(session, resolvedNpcId, request) {
    if (request.subcmd !== 0x02 || session.currentMapId !== CHILL_PASS_MAP_ID) {
        return false;
    }
    if (resolvedNpcId !== CHILL_PASS_FROG_TELEPORTOR_NPC_ID) {
        return false;
    }
    const scriptId = Number.isInteger(request.scriptId) ? (request.scriptId >>> 0) : 0;
    if (scriptId !== CHILL_PASS_FROG_TELEPORT_SCRIPT_ID) {
        return false;
    }
    if (typeof session.sendSceneEnter !== 'function') {
        return false;
    }
    const currentCoins = Number.isInteger(session.coins) ? Math.max(0, session.coins) : 0;
    if (currentCoins < CHILL_PASS_FROG_TELEPORT_PRICE) {
        session.sendGameDialogue('FrogTeleportor', `You need ${CHILL_PASS_FROG_TELEPORT_PRICE} coins to travel to Cloud City.`);
        return true;
    }
    session.coins = currentCoins - CHILL_PASS_FROG_TELEPORT_PRICE;
    sendSelfStateValueUpdate(session, 'coins', session.coins);
    session.persistCurrentCharacter();
    session.log(`Sending Chill Pass FrogTeleportor scene-enter map=${CLOUD_CITY_MAP_ID} pos=${CLOUD_CITY_FROG_TELEPORT_ENTRY_X},${CLOUD_CITY_FROG_TELEPORT_ENTRY_Y} cost=${CHILL_PASS_FROG_TELEPORT_PRICE} remainingCoins=${session.coins}`);
    session.sendSceneEnter(CLOUD_CITY_MAP_ID, CLOUD_CITY_FROG_TELEPORT_ENTRY_X, CLOUD_CITY_FROG_TELEPORT_ENTRY_Y);
    return true;
}
function handleMirrorLakeSpiritReturnRequest(session, resolvedNpcId, request) {
    if (request.subcmd !== 0x02 || session.currentMapId !== MIRROR_LAKE_MAP_ID) {
        return false;
    }
    if (resolvedNpcId !== MIRROR_LAKE_SPIRIT_NPC_ID) {
        return false;
    }
    const scriptId = Number.isInteger(request.scriptId) ? (request.scriptId >>> 0) : 0;
    if (scriptId !== MIRROR_LAKE_SPIRIT_RETURN_SCRIPT_ID) {
        return false;
    }
    if (typeof session.sendSceneEnter !== 'function') {
        return false;
    }
    session.log(`Sending Mirror Lake spirit scene-enter map=${BLURRED_LAKE_MAP_ID} pos=${BLURRED_LAKE_ENTRY_X},${BLURRED_LAKE_ENTRY_Y}`);
    session.sendSceneEnter(BLURRED_LAKE_MAP_ID, BLURRED_LAKE_ENTRY_X, BLURRED_LAKE_ENTRY_Y);
    return true;
}
function handleMirrorLakeSpiritPalaceRequest(session, resolvedNpcId, request) {
    if (request.subcmd !== 0x02 || session.currentMapId !== MIRROR_LAKE_MAP_ID) {
        return false;
    }
    if (resolvedNpcId !== MIRROR_LAKE_SPIRIT_NPC_ID) {
        return false;
    }
    const scriptId = Number.isInteger(request.scriptId) ? (request.scriptId >>> 0) : 0;
    if (scriptId !== MIRROR_LAKE_SPIRIT_PALACE_SCRIPT_ID) {
        return false;
    }
    if (typeof session.sendSceneEnter !== 'function') {
        return false;
    }
    session.log(`Sending Mirror Lake spirit palace scene-enter map=${MIRROR_PALACE_MAP_ID} pos=${MIRROR_PALACE_ENTRY_X},${MIRROR_PALACE_ENTRY_Y}`);
    session.sendSceneEnter(MIRROR_PALACE_MAP_ID, MIRROR_PALACE_ENTRY_X, MIRROR_PALACE_ENTRY_Y);
    return true;
}
function handleBlurredLakeSpiritPalaceRequest(session, resolvedNpcId, request) {
    if (request.subcmd !== 0x02 || session.currentMapId !== BLURRED_LAKE_MAP_ID) {
        return false;
    }
    if (resolvedNpcId !== BLURRED_LAKE_SPIRIT_NPC_ID) {
        return false;
    }
    const scriptId = Number.isInteger(request.scriptId) ? (request.scriptId >>> 0) : 0;
    if (scriptId !== BLURRED_LAKE_SPIRIT_PALACE_SCRIPT_ID) {
        return false;
    }
    if (typeof session.sendSceneEnter !== 'function') {
        return false;
    }
    session.log(`Sending Blurred Lake spirit scene-enter map=${DEEP_CORRIDOR_MAP_ID} pos=${DEEP_CORRIDOR_ENTRY_X},${DEEP_CORRIDOR_ENTRY_Y}`);
    session.sendSceneEnter(DEEP_CORRIDOR_MAP_ID, DEEP_CORRIDOR_ENTRY_X, DEEP_CORRIDOR_ENTRY_Y);
    return true;
}
function handleReceiverGhostMirrorLakeRequest(session, resolvedNpcId, request) {
    if (request.subcmd !== 0x02 || session.currentMapId !== MIRROR_PALACE_MAP_ID) {
        return false;
    }
    if (resolvedNpcId !== RECEIVER_GHOST_NPC_ID) {
        return false;
    }
    const scriptId = Number.isInteger(request.scriptId) ? (request.scriptId >>> 0) : 0;
    if (scriptId !== RECEIVER_GHOST_MIRROR_LAKE_SCRIPT_ID) {
        return false;
    }
    if (typeof session.sendSceneEnter !== 'function') {
        return false;
    }
    session.log(`Sending Receiver Ghost scene-enter map=${MIRROR_LAKE_MAP_ID} pos=${MIRROR_LAKE_RETURN_X},${MIRROR_LAKE_RETURN_Y}`);
    session.sendSceneEnter(MIRROR_LAKE_MAP_ID, MIRROR_LAKE_RETURN_X, MIRROR_LAKE_RETURN_Y);
    return true;
}
function handleLongicornSoldierSomberAisleRequest(session, resolvedNpcId, request) {
    if (request.subcmd !== 0x02 || session.currentMapId !== LONGICORN_HOLE_MAP_ID) {
        return false;
    }
    if (resolvedNpcId !== LONGICORN_SOLDIER_NPC_ID) {
        return false;
    }
    const scriptId = Number.isInteger(request.scriptId) ? (request.scriptId >>> 0) : 0;
    if (scriptId !== LONGICORN_SOLDIER_SOMBER_AISLE_SCRIPT_ID) {
        return false;
    }
    if (typeof session.sendSceneEnter !== 'function') {
        return false;
    }
    session.log(`Sending Longicorn Soldier scene-enter map=${SOMBER_AISLE_MAP_ID} pos=${SOMBER_AISLE_ENTRY_X},${SOMBER_AISLE_ENTRY_Y}`);
    session.sendSceneEnter(SOMBER_AISLE_MAP_ID, SOMBER_AISLE_ENTRY_X, SOMBER_AISLE_ENTRY_Y);
    return true;
}
function handleBeetleGuideSilentHillRequest(session, resolvedNpcId, request) {
    if (request.subcmd !== 0x02 || session.currentMapId !== CHAIN_PEAK_MAP_ID) {
        return false;
    }
    if (resolvedNpcId !== BEETLE_GUIDE_NPC_ID) {
        return false;
    }
    const scriptId = Number.isInteger(request.scriptId) ? (request.scriptId >>> 0) : 0;
    if (scriptId !== BEETLE_GUIDE_SILENT_HILL_SCRIPT_ID) {
        return false;
    }
    if (typeof session.sendSceneEnter !== 'function') {
        return false;
    }
    session.log(`Sending Beetle Guide scene-enter map=${SILENT_HILL_MAP_ID} pos=${SILENT_HILL_ENTRY_X},${SILENT_HILL_ENTRY_Y}`);
    session.sendSceneEnter(SILENT_HILL_MAP_ID, SILENT_HILL_ENTRY_X, SILENT_HILL_ENTRY_Y);
    return true;
}
function handleFrontierSoldierSpringForestRequest(session, resolvedNpcId, request) {
    if (request.subcmd !== 0x02 || session.currentMapId !== ZIG_PASS_MAP_ID) {
        return false;
    }
    if (resolvedNpcId !== FRONTIER_SOLDIER_NPC_ID) {
        return false;
    }
    const scriptId = Number.isInteger(request.scriptId) ? (request.scriptId >>> 0) : 0;
    if (scriptId !== FRONTIER_SOLDIER_RETURN_SCRIPT_ID) {
        return false;
    }
    if (typeof session.sendSceneEnter !== 'function') {
        return false;
    }
    session.log(`Sending Frontier Soldier scene-enter map=${SPRING_FOREST_MAP_ID} pos=${SPRING_FOREST_ENTRY_X},${SPRING_FOREST_ENTRY_Y}`);
    session.sendSceneEnter(SPRING_FOREST_MAP_ID, SPRING_FOREST_ENTRY_X, SPRING_FOREST_ENTRY_Y);
    return true;
}
function applyQuestNpcAuxiliaryActions(session, questState, npcId, request) {
    if (!Array.isArray(questState?.activeQuests) || questState.activeQuests.length < 1) {
        return null;
    }
    const requestSubtype = Number.isInteger(request.subcmd) ? (request.subcmd >>> 0) : 0;
    const requestScriptId = Number.isInteger(request.scriptId)
        ? (request.scriptId >>> 0)
        : (Number.isInteger(request.rawArgs?.[2]) ? (request.rawArgs[2] >>> 0) : 0);
    const requestContextId = Number.isInteger(request.rawArgs?.[1]) ? (request.rawArgs[1] >>> 0) : 0;
    const mapId = Number.isInteger(session.currentMapId) ? (session.currentMapId >>> 0) : 0;
    let stateChanged = false;
    for (const record of questState.activeQuests) {
        const taskId = Number.isInteger(record?.id) ? (record.id >>> 0) : 0;
        if (taskId <= 0) {
            continue;
        }
        const definition = getQuestDefinition(taskId);
        const step = getCurrentStep(definition, record);
        const stepStatus = Number.isInteger(step?.tracker?.status)
            ? (step?.tracker?.status >>> 0)
            : (Number.isInteger(record?.status) ? (record.status >>> 0) : 0);
        const interactionTriggers = Array.isArray(definition?.interactionTriggers)
            ? definition.interactionTriggers
            : [];
        for (const trigger of interactionTriggers) {
            if (trigger?.kind !== 'server-run') {
                continue;
            }
            if (!matchesTrigger({
                stepStatus: Number.isInteger(trigger?.stepStatus) ? (trigger.stepStatus >>> 0) : undefined,
                subtype: Number.isInteger(trigger?.subtype) ? (trigger.subtype >>> 0) : undefined,
                npcId: Number.isInteger(trigger?.npcId) ? (trigger.npcId >>> 0) : undefined,
                scriptId: Number.isInteger(trigger?.scriptId) ? (trigger.scriptId >>> 0) : undefined,
                mapId: Number.isInteger(trigger?.mapId) ? (trigger.mapId >>> 0) : undefined,
                contextId: Number.isInteger(trigger?.contextId) ? (trigger.contextId >>> 0) : undefined,
            }, {
                stepStatus,
                subtype: requestSubtype,
                npcId: npcId >>> 0,
                scriptId: requestScriptId,
                mapId,
                contextId: requestContextId,
            })) {
                continue;
            }
            if (trigger?.combat) {
                const monsterId = Number.isInteger(trigger.combat?.monsterId) ? (trigger.combat.monsterId >>> 0) : 0;
                if (monsterId <= 0) {
                    continue;
                }
                return {
                    events: [],
                    stateChanged,
                    combatTrigger: {
                        taskId,
                        monsterId,
                        count: Math.max(1, Number.isInteger(trigger.combat?.count) ? trigger.combat.count : 1),
                    },
                };
            }
            if (typeof trigger?.setProgressFlag === 'string' && trigger.setProgressFlag.length > 0) {
                const hadFlag = record.progress?.[trigger.setProgressFlag] === true;
                record.progress = {
                    ...(record.progress && typeof record.progress === 'object' ? record.progress : {}),
                    [trigger.setProgressFlag]: true,
                };
                stateChanged = stateChanged || !hadFlag;
            }
            const events = [];
            for (const item of Array.isArray(trigger?.consumeItems) ? trigger.consumeItems : []) {
                const templateId = Number.isInteger(item?.templateId) ? (item.templateId >>> 0) : 0;
                const quantity = Math.max(1, Number.isInteger(item?.quantity) ? item.quantity : 1);
                if (templateId <= 0) {
                    continue;
                }
                if (getBagQuantityByTemplateId(session, templateId) < quantity) {
                    events.push({
                        type: 'item-missing',
                        taskId,
                        definition,
                        templateId,
                        quantity,
                        itemName: typeof item?.name === 'string' ? item.name : '',
                        reason: 'auxiliary-consume-missing',
                    });
                    return { events, stateChanged, combatTrigger: null };
                }
                events.push({
                    type: 'item-consumed',
                    taskId,
                    definition,
                    templateId,
                    quantity,
                    itemName: typeof item?.name === 'string' ? item.name : '',
                    reason: 'auxiliary-consume-item',
                });
            }
            for (const item of Array.isArray(trigger?.grantItems) ? trigger.grantItems : []) {
                const templateId = Number.isInteger(item?.templateId) ? (item.templateId >>> 0) : 0;
                const quantity = Math.max(1, Number.isInteger(item?.quantity) ? item.quantity : 1);
                if (templateId <= 0) {
                    continue;
                }
                if (Number.isInteger(trigger?.onlyIfMissingTemplateId) &&
                    (trigger.onlyIfMissingTemplateId >>> 0) === templateId &&
                    getBagQuantityByTemplateId(session, templateId) > 0) {
                    continue;
                }
                events.push({
                    type: 'item-granted',
                    taskId,
                    definition,
                    templateId,
                    quantity,
                    itemName: typeof item?.name === 'string' ? item.name : '',
                    reason: 'auxiliary-grant-item',
                });
            }
            return { events, stateChanged, combatTrigger: null };
        }
    }
    return null;
}
function countMatchingQuestItems(session, item) {
    const bagItems = Array.isArray(session.bagItems) ? session.bagItems : [];
    const rawCapturedMonsterId = item?.capturedMonsterId;
    const requiredCapturedMonsterId = typeof rawCapturedMonsterId === 'number' && Number.isInteger(rawCapturedMonsterId)
        ? (rawCapturedMonsterId >>> 0)
        : 0;
    if (requiredCapturedMonsterId <= 0) {
        return getBagQuantityByTemplateId(session, item.templateId >>> 0);
    }
    return bagItems.reduce((total, bagItem) => {
        const bagTemplateId = bagItem?.templateId >>> 0;
        if (bagItem?.equipped === true) {
            return total;
        }
        if (isMobFlaskTemplateId(item.templateId >>> 0)) {
            if (!isMobFlaskTemplateId(bagTemplateId)) {
                return total;
            }
        }
        else if (bagTemplateId !== (item.templateId >>> 0)) {
            return total;
        }
        const capturedMonsterId = Number.isInteger(bagItem?.attributePairs?.[0]?.value)
            ? (bagItem.attributePairs[0].value >>> 0)
            : (Number.isInteger(bagItem?.extraValue) ? (bagItem.extraValue >>> 0) : 0);
        if (capturedMonsterId !== requiredCapturedMonsterId) {
            return total;
        }
        return total + Math.max(1, Number.isInteger(bagItem?.quantity) ? bagItem.quantity : 1);
    }, 0);
}
function isMobFlaskTemplateId(templateId) {
    return templateId >= 29000 && templateId <= 29011;
}
function handleInnRestRequest(session, npcId, request) {
    if (request.subcmd !== 0x02 ||
        !Number.isInteger(request.scriptId) ||
        (request.scriptId >>> 0) !== INN_REST_SCRIPT_ID) {
        return false;
    }
    const price = resolveInnRestPrice(session);
    const currentCoins = Number.isInteger(session.coins) ? Math.max(0, session.coins) : 0;
    if (currentCoins < price) {
        session.sendGameDialogue('Waiter', `You need ${price} coins to rest here.`);
        return true;
    }
    recomputeSessionMaxVitals(session);
    const nextVitals = resolveInnRestVitals(session);
    session.coins = currentCoins - price;
    session.currentHealth = nextVitals.health;
    session.currentMana = nextVitals.mana;
    session.currentRage = nextVitals.rage;
    sendSelfStateValueUpdate(session, 'coins', session.coins);
    sendSelfStateVitalsUpdate(session, nextVitals);
    session.persistCurrentCharacter();
    const speaker = resolveInnRestSpeaker(session, npcId);
    session.sendGameDialogue(speaker, price > 0 ? `You paid ${price} coins and had a good rest.` : 'You had a good rest.');
    return true;
}
function resolveInnRestPrice(session) {
    const level = Number.isInteger(session.level) ? session.level >>> 0 : 1;
    return level < 10 ? 0 : level * 10;
}
function resolveInnRestSpeaker(session, npcId) {
    const name = resolveNpcNameForCurrentMap(session, npcId);
    return name || 'Inn';
}
function resolveNpcNameForCurrentMap(session, npcId) {
    const mapNpcs = getMapNpcs(session.currentMapId);
    const npcs = Array.isArray(mapNpcs?.npcs) ? mapNpcs.npcs : [];
    const npc = npcs.find((entry) => Number.isInteger(entry?.npcId) && (entry.npcId >>> 0) === (npcId >>> 0)) || null;
    return typeof npc?.name === 'string' && npc.name.length > 0 ? npc.name : '';
}
function resolveNpcInteractionTarget(session, request) {
    const mapNpcs = getMapNpcs(session.currentMapId);
    const npcs = Array.isArray(mapNpcs?.npcs) ? mapNpcs.npcs : [];
    if (npcs.length === 0) {
        return null;
    }
    if (request.subcmd === 0x08) {
        const npcIndex = Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] >>> 0 : 0;
        if (npcIndex >= 1 && npcIndex <= npcs.length) {
            return npcs[npcIndex - 1] || null;
        }
        return null;
    }
    const npcKey = Number.isInteger(request.npcId)
        ? request.npcId >>> 0
        : Number.isInteger(request.rawArgs?.[0])
            ? request.rawArgs[0] >>> 0
            : 0;
    if (npcKey <= 0) {
        return null;
    }
    const directMatch = npcs.find((npc) => {
        if (!Number.isInteger(npc?.npcId)) {
            return false;
        }
        if ((npc.npcId >>> 0) === npcKey) {
            return true;
        }
        return Number.isInteger(npc.resolvedSpawnEntityType) && (npc.resolvedSpawnEntityType >>> 0) === npcKey;
    });
    if (directMatch) {
        return directMatch;
    }
    if (npcKey >= 1 && npcKey <= npcs.length) {
        return npcs[npcKey - 1] || null;
    }
    return null;
}
function sendNpcShopOpen(session, npcId, request) {
    const npc = resolveNpcInteractionTarget(session, request);
    const catalog = resolveShopCatalog(session.currentMapId, npcId);
    if (!catalog || !Array.isArray(catalog.items) || catalog.items.length < 1) {
        session.log(`NPC shop open skipped npcId=${npcId} mapId=${session.currentMapId} reason=no-catalog`);
        return;
    }
    const npcKey = Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0;
    const speaker = typeof npc?.name === 'string' && npc.name.length > 0
        ? npc.name
        : typeof catalog.speaker === 'string' && catalog.speaker.length > 0
            ? catalog.speaker
            : 'Shop';
    const packet = buildNpcShopOpenPacket({
        items: catalog.items.map((item) => ({
            templateId: item.templateId,
            price: item.price,
        })),
    });
    session.activeNpcShop = {
        key: `npc-shop-${session.currentMapId}-${npcId}`,
        npcId,
        npcKey,
        mapId: session.currentMapId,
        speaker,
        openedAt: Date.now(),
        items: catalog.items.map((item) => ({
            templateId: item.templateId,
            goldPrice: item.price,
            coinPrice: item.price,
        })),
    };
    session.writePacket(packet, DEFAULT_FLAGS, `Sending npc shop open cmd=0x${GAME_NPC_SHOP_CMD.toString(16)} subtype=0x07 npcId=${npcId} mapId=${session.currentMapId} npcKey=${npcKey} items=${catalog.items.length} speaker="${speaker}" source=json-registry packetHex=${packet.toString('hex')}`);
}
function resolveShopCatalog(mapId, npcId) {
    const mapOverride = Array.isArray(NPC_SHOP_REGISTRY.mapOverrides)
        ? NPC_SHOP_REGISTRY.mapOverrides.find((entry) => Number.isInteger(entry?.mapId) && entry.mapId === mapId && Number.isInteger(entry?.npcId) && entry.npcId === npcId) || null
        : null;
    if (mapOverride && Array.isArray(mapOverride.items) && mapOverride.items.length > 0) {
        return normalizeShopCatalogRecord(mapOverride);
    }
    const defaultsByNpcId = NPC_SHOP_REGISTRY.defaultsByNpcId && typeof NPC_SHOP_REGISTRY.defaultsByNpcId === 'object'
        ? NPC_SHOP_REGISTRY.defaultsByNpcId
        : {};
    const defaultCatalog = defaultsByNpcId[String(npcId)] || null;
    if (!defaultCatalog) {
        return null;
    }
    return normalizeShopCatalogRecord(defaultCatalog);
}
function normalizeShopCatalogRecord(source) {
    const items = Array.isArray(source?.items)
        ? source.items
            .filter((item) => Number.isInteger(item?.templateId) &&
            item.templateId > 0 &&
            Number.isInteger(item?.price) &&
            item.price > 0)
            .map((item) => ({
            templateId: item.templateId >>> 0,
            price: item.price >>> 0,
        }))
        : [];
    if (items.length < 1) {
        return null;
    }
    return {
        speaker: typeof source?.speaker === 'string' ? source.speaker : '',
        items,
    };
}
function handleHousewifeTeachingRequest(session, npcId, request) {
    if ((npcId >>> 0) !== HOUSEWIFE_NPC_ID || request.subcmd !== 0x02) {
        return false;
    }
    const learnedLifeSkillIds = HOUSEWIFE_LIFE_SKILL_IDS.filter((skillId) => Array.isArray(session.skillState?.learnedSkills)
        ? session.skillState.learnedSkills.some((entry) => Number(entry?.skillId || 0) === skillId)
        : false);
    const unlearnedSkillIds = HOUSEWIFE_LIFE_SKILL_IDS.filter((skillId) => !learnedLifeSkillIds.includes(skillId));
    if (unlearnedSkillIds.length === 0) {
        session.sendGameDialogue('Housewife', 'You already know every life skill I can teach.');
        return true;
    }
    const renownCost = resolveHousewifeTeachingCost(learnedLifeSkillIds.length);
    if ((session.renown || 0) < renownCost) {
        session.sendGameDialogue('Housewife', `You need ${renownCost} renown for the next life-skill lesson.`);
        return true;
    }
    const skillId = unlearnedSkillIds[0];
    const grantResult = grantSkill(session, skillId, {
        autoAssignHotbar: false,
        skipRequirementChecks: true,
    });
    if (!grantResult.ok) {
        session.sendGameDialogue('Housewife', grantResult.reason || 'I cannot teach you that skill right now.');
        return true;
    }
    if (renownCost > 0) {
        applyEffects(session, [{ kind: 'update-stat', stat: 'renown', delta: -renownCost }], {
            suppressDialogues: true,
        });
    }
    sendSkillStateSync(session, `housewife-teach skillId=${skillId}`);
    session.persistCurrentCharacter();
    const skillName = HOUSEWIFE_LIFE_SKILL_NAMES[skillId] || `skill ${skillId}`;
    const costSuffix = renownCost > 0 ? ` Cost: ${renownCost} renown.` : ' Your first lesson is free.';
    session.sendGameDialogue('Housewife', `You learned ${skillName}.${costSuffix}`);
    return true;
}
function resolveHousewifeTeachingCost(learnedCount) {
    if (learnedCount <= 0) {
        return 0;
    }
    if (learnedCount === 1) {
        return 300;
    }
    if (learnedCount === 2) {
        return 600;
    }
    return 900;
}
function loadNpcShopRegistry() {
    try {
        const raw = fs.readFileSync(NPC_SHOP_REGISTRY_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch (_err) {
        return {};
    }
}
export { handleNpcInteractionRequest, };
