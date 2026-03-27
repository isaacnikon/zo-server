import { GAME_FIGHT_RESULT_CMD } from '../config.js';
import { consumeBagItemByInstanceId, getBagItemByReference, getItemDefinition } from '../inventory/index.js';
import { createOwnedPet } from '../pet-runtime.js';
import { getCapturePetTemplateId, getRoleName } from '../roleinfo/index.js';
import { sendConsumeResultPackets, sendInventoryFullSync } from './inventory-runtime.js';
import { sendSelfStateValueUpdate } from './stat-sync.js';
import type { GameSession } from '../types.js';

const PET_CURER_NPC_ID = 3013;
const MAX_PET_CAPACITY = 3;

type MixedNpcServiceRequest = {
  uiSubcmd: number;
  cmdWord: number;
  opcode: number;
  supportItemRef: number;
  supportIndex: number;
  monsterFlaskRef: number;
  extraRef: number;
  tailValue: number;
  rawHex: string;
};

export function primeNpcServiceContext(session: GameSession, npcId: number, serviceId: number): void {
  if ((npcId >>> 0) === PET_CURER_NPC_ID) {
    session.activeNpcService = {
      kind: 'pet-curer',
      npcId: PET_CURER_NPC_ID,
      mapId: session.currentMapId >>> 0,
      serviceId: serviceId >>> 0,
      openedAt: Date.now(),
    };
    return;
  }

  session.activeNpcService = null;
}

export function tryHandleNpcServicePacket(session: GameSession, payload: Buffer): boolean {
  const request = parseMixedNpcServiceRequest(payload);
  if (!request) {
    return false;
  }

  const context = session.activeNpcService;
  if (context?.kind === 'pet-curer' || looksLikePetCurerTameRequest(session, request)) {
    return handlePetCurerTameRequest(session, request);
  }

  return false;
}

function parseMixedNpcServiceRequest(payload: Buffer): MixedNpcServiceRequest | null {
  if (!Buffer.isBuffer(payload) || payload.length < 18) {
    return null;
  }
  if ((payload[0] & 0xff) !== 0x08) {
    return null;
  }
  if ((payload.readUInt16LE(1) >>> 0) !== GAME_FIGHT_RESULT_CMD) {
    return null;
  }
  if ((payload[3] & 0xff) !== 0x0d) {
    return null;
  }

  return {
    uiSubcmd: payload[0] & 0xff,
    cmdWord: payload.readUInt16LE(1) >>> 0,
    opcode: payload[3] & 0xff,
    supportItemRef: payload.readUInt32LE(4) >>> 0,
    supportIndex: payload.readUInt16LE(8) >>> 0,
    monsterFlaskRef: payload.readUInt16LE(10) >>> 0,
    extraRef: payload.readUInt16LE(12) >>> 0,
    tailValue: payload.readUInt32LE(14) >>> 0,
    rawHex: payload.toString('hex'),
  };
}

function looksLikePetCurerTameRequest(session: GameSession, request: MixedNpcServiceRequest): boolean {
  const flaskItem = getBagItemByReference(session, request.monsterFlaskRef >>> 0);
  if (!flaskItem) {
    return false;
  }
  return isMobFlaskTemplateId(flaskItem.templateId >>> 0);
}

function handlePetCurerTameRequest(session: GameSession, request: MixedNpcServiceRequest): boolean {
  const flaskItem = getBagItemByReference(session, request.monsterFlaskRef >>> 0);
  const supportItem = getBagItemByReference(session, request.supportItemRef >>> 0);
  const extraItem = getBagItemByReference(session, request.extraRef >>> 0);

  if (!flaskItem || !isMobFlaskTemplateId(flaskItem.templateId >>> 0)) {
    session.log(
      `NPC service pet-curer rejected reason=missing-flask flaskRef=${request.monsterFlaskRef} supportRef=${request.supportItemRef} extraRef=${request.extraRef} hex=${request.rawHex}`
    );
    session.sendGameDialogue('Pet Curer', 'Place a valid monster flask into the Monster slot.');
    return true;
  }

  if (!supportItem || (supportItem.instanceId >>> 0) === (flaskItem.instanceId >>> 0)) {
    session.log(
      `NPC service pet-curer rejected reason=missing-support flaskInstanceId=${flaskItem.instanceId >>> 0} supportRef=${request.supportItemRef} extraRef=${request.extraRef} hex=${request.rawHex}`
    );
    session.sendGameDialogue('Pet Curer', 'Place an item into the Item slot before taming.');
    return true;
  }

  const capturedMonsterId = resolveCapturedMonsterId(flaskItem);
  const flaskStateCode =
    typeof flaskItem.stateCode === 'number' && Number.isInteger(flaskItem.stateCode)
      ? (flaskItem.stateCode & 0xff)
      : 0;
  if (capturedMonsterId <= 0 || flaskStateCode === 0) {
    session.log(
      `NPC service pet-curer rejected reason=empty-flask flaskInstanceId=${flaskItem.instanceId >>> 0} state=${flaskStateCode} capturedMonsterId=${capturedMonsterId} hex=${request.rawHex}`
    );
    session.sendGameDialogue('Pet Curer', 'That flask does not contain a captured monster.');
    return true;
  }

  const petTemplateId = getCapturePetTemplateId(capturedMonsterId) || 0;
  if (petTemplateId <= 0) {
    session.log(
      `NPC service pet-curer rejected reason=no-pet-template flaskInstanceId=${flaskItem.instanceId >>> 0} capturedMonsterId=${capturedMonsterId} hex=${request.rawHex}`
    );
    session.sendGameDialogue('Pet Curer', 'That monster cannot be tamed yet.');
    return true;
  }

  const capturedLevel = resolveCapturedMonsterLevel(flaskItem);
  const tameCost = resolvePetCurerTameGoldCost(capturedLevel);
  if ((session.gold >>> 0) < tameCost) {
    session.log(
      `NPC service pet-curer rejected reason=insufficient-gold flaskInstanceId=${flaskItem.instanceId >>> 0} supportInstanceId=${supportItem.instanceId >>> 0} gold=${session.gold >>> 0} cost=${tameCost} capturedLevel=${capturedLevel}`
    );
    session.sendGameDialogue('Pet Curer', `You need ${tameCost} gold to tame that monster.`);
    return true;
  }

  if (!Array.isArray(session.pets)) {
    session.pets = [];
  }
  if (session.pets.length >= MAX_PET_CAPACITY) {
    session.log(
      `NPC service pet-curer rejected reason=pet-capacity pets=${session.pets.length} cap=${MAX_PET_CAPACITY}`
    );
    session.sendGameDialogue('Pet Curer', 'You cannot carry any more pets right now.');
    return true;
  }

  const newPet = createOwnedPet(
    petTemplateId >>> 0,
    {
      level: capturedLevel,
      name: getRoleName(petTemplateId) || undefined,
    },
    session.pets.length
  );
  if (!newPet) {
    session.log(
      `NPC service pet-curer rejected reason=create-pet-failed petTemplateId=${petTemplateId} capturedMonsterId=${capturedMonsterId}`
    );
    session.sendGameDialogue('Pet Curer', 'I could not tame that monster right now.');
    return true;
  }

  const flaskConsumeResult = consumeBagItemByInstanceId(session, flaskItem.instanceId >>> 0, 1);
  if (!flaskConsumeResult.ok) {
    session.log(
      `NPC service pet-curer rejected reason=consume-flask-failed flaskInstanceId=${flaskItem.instanceId >>> 0} templateId=${flaskItem.templateId >>> 0} failure=${flaskConsumeResult.reason || 'unknown'}`
    );
    session.sendGameDialogue('Pet Curer', 'That monster flask could not be consumed.');
    return true;
  }

  const supportConsumeResult = consumeBagItemByInstanceId(session, supportItem.instanceId >>> 0, 1);
  if (!supportConsumeResult.ok) {
    session.log(
      `NPC service pet-curer rejected reason=consume-support-failed supportInstanceId=${supportItem.instanceId >>> 0} templateId=${supportItem.templateId >>> 0} failure=${supportConsumeResult.reason || 'unknown'}`
    );
    session.sendGameDialogue('Pet Curer', 'That item could not be used for taming.');
    return true;
  }

  session.gold = Math.max(0, (session.gold >>> 0) - tameCost);
  session.pets.push(newPet);

  sendConsumeResultPackets(session, flaskConsumeResult);
  sendConsumeResultPackets(session, supportConsumeResult);
  sendInventoryFullSync(session);
  sendSelfStateValueUpdate(session, 'gold', session.gold >>> 0);
  session.sendPetStateSync('npc-service-pet-curer-tame');
  session.persistCurrentCharacter();

  const capturedMonsterName = getRoleName(capturedMonsterId) || `monster ${capturedMonsterId}`;
  const supportItemName = getItemDefinition(supportItem.templateId)?.name || `item ${supportItem.templateId}`;
  const extraText =
    extraItem && (extraItem.instanceId >>> 0) !== (flaskItem.instanceId >>> 0) && (extraItem.instanceId >>> 0) !== (supportItem.instanceId >>> 0)
      ? ` extraRef=${extraItem.instanceId >>> 0}/${extraItem.templateId >>> 0}`
      : '';
  session.log(
    `NPC service pet-curer tame ok flaskInstanceId=${flaskItem.instanceId >>> 0} capturedMonsterId=${capturedMonsterId} capturedMonsterName="${capturedMonsterName}" supportInstanceId=${supportItem.instanceId >>> 0} supportTemplateId=${supportItem.templateId >>> 0} supportItem="${supportItemName}" petTemplateId=${petTemplateId} petName="${newPet.name}" level=${capturedLevel} cost=${tameCost} supportIndex=${request.supportIndex} extraRef=${request.extraRef} tailValue=${request.tailValue}${extraText}`
  );
  session.sendGameDialogue('Pet Curer', `${capturedMonsterName} has been tamed into ${newPet.name}.`);
  return true;
}

function resolveCapturedMonsterId(flaskItem: Record<string, any>): number {
  const attributePairs = Array.isArray(flaskItem.attributePairs) ? flaskItem.attributePairs : [];
  if (Number.isInteger(attributePairs[0]?.value) && attributePairs[0].value > 0) {
    return attributePairs[0].value >>> 0;
  }
  if (Number.isInteger(flaskItem.extraValue) && flaskItem.extraValue > 0) {
    return flaskItem.extraValue >>> 0;
  }
  return 0;
}

function resolveCapturedMonsterLevel(flaskItem: Record<string, any>): number {
  const attributePairs = Array.isArray(flaskItem.attributePairs) ? flaskItem.attributePairs : [];
  if (Number.isInteger(attributePairs[1]?.value) && attributePairs[1].value > 0) {
    return Math.max(1, attributePairs[1].value >>> 0);
  }
  return 1;
}

function resolvePetCurerTameGoldCost(capturedLevel: number): number {
  return Math.max(30, Math.max(1, capturedLevel >>> 0) * 30);
}

function isMobFlaskTemplateId(templateId: number): boolean {
  return templateId >= 29000 && templateId <= 29011;
}
