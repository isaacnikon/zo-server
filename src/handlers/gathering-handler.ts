import { DEFAULT_FLAGS } from '../config.js';
import { applyEffects } from '../effects/effect-executor.js';
import {
  decrementToolDurability,
  resolveGatheringSkillId,
  rollGatherLoot,
  validateGatherAccess,
} from '../gameplay/gathering-runtime.js';
import { syncInventoryStateToClient } from '../gameplay/inventory-runtime.js';
import { resolveStoredSkillLevel } from '../gameplay/skill-runtime.js';
import {
  buildGatherFailedPacket,
  buildGatherRewardPacket,
  buildGatherStartConfirmPacket,
} from '../protocol/gameplay-packets.js';
import type { GameSession } from '../types.js';

const GATHER_START_SUBCMD = 0x0b;
const GATHER_COMPLETE_SUBCMD = 0x0d;

export function handleGatheringRequest(session: GameSession, payload: Buffer): boolean {
  if (payload.length < 3) {
    return false;
  }

  const subcmd = payload[2];
  if (subcmd === GATHER_START_SUBCMD) {
    handleGatherStart(session, payload);
    return true;
  }
  if (subcmd === GATHER_COMPLETE_SUBCMD) {
    handleGatherComplete(session, payload);
    return true;
  }

  return false;
}

function handleGatherStart(session: GameSession, payload: Buffer): void {
  if (payload.length < 7) {
    session.writePacket(buildGatherFailedPacket(), DEFAULT_FLAGS, 'Gather start rejected: short payload');
    return;
  }

  const runtimeId = payload.readUInt32BE(3) >>> 0;
  const validation = validateGatherAccess(session, runtimeId);
  if (!validation.ok || !validation.node || !validation.toolType) {
    session.activeGather = null;
    session.log(
      `Gather start rejected runtimeId=${runtimeId} map=${session.currentMapId} reason=${validation.reason || 'unknown'}`
    );
    session.writePacket(buildGatherFailedPacket(), DEFAULT_FLAGS, `Gather start failed reason=${validation.reason || 'unknown'}`);
    maybeSendGatherFailureDialogue(session, validation.reason);
    return;
  }

  session.activeGather = { runtimeId, startedAt: Date.now() };
  session.writePacket(
    buildGatherStartConfirmPacket(validation.toolType),
    DEFAULT_FLAGS,
    `Gather start confirm runtimeId=${runtimeId} toolType=${validation.toolType}`
  );
}

function handleGatherComplete(session: GameSession, payload: Buffer): void {
  if (payload.length < 7) {
    session.activeGather = null;
    session.writePacket(buildGatherFailedPacket(), DEFAULT_FLAGS, 'Gather complete rejected: short payload');
    return;
  }

  const runtimeId = payload.readUInt32BE(3) >>> 0;
  if (!session.activeGather || (session.activeGather.runtimeId >>> 0) !== runtimeId) {
    session.log(
      `Gather complete rejected runtimeId=${runtimeId} expected=${session.activeGather?.runtimeId ?? 'none'} map=${session.currentMapId}`
    );
    session.activeGather = null;
    session.writePacket(buildGatherFailedPacket(), DEFAULT_FLAGS, 'Gather complete failed: runtime mismatch');
    return;
  }

  const validation = validateGatherAccess(session, runtimeId);
  if (!validation.ok || !validation.node || !validation.bagItem) {
    session.activeGather = null;
    session.writePacket(buildGatherFailedPacket(), DEFAULT_FLAGS, `Gather complete failed reason=${validation.reason || 'unknown'}`);
    return;
  }

  const skillId = resolveGatheringSkillId(validation.node.toolType);
  const skillLevel = skillId ? resolveStoredSkillLevel(session, skillId) : 1;
  const dropItemId = rollGatherLoot(validation.node, skillLevel);
  const grantResult = dropItemId
    ? applyEffects(session, [{ kind: 'grant-item', templateId: dropItemId, quantity: 1 }], {
        suppressDialogues: true,
        suppressPackets: true,
        suppressPersist: true,
      })
    : null;

  if (dropItemId && grantResult?.inventoryDirty !== true) {
    session.activeGather = null;
    session.writePacket(buildGatherFailedPacket(), DEFAULT_FLAGS, `Gather reward failed: bag full runtimeId=${runtimeId}`);
    session.sendGameDialogue('Gathering', 'Your pack is full.');
    return;
  }

  decrementToolDurability(session, validation.bagItem);
  syncInventoryStateToClient(session);
  session.persistCurrentCharacter();

  session.writePacket(
    buildGatherRewardPacket(0),
    DEFAULT_FLAGS,
    `Gather reward runtimeId=${runtimeId} dropItemId=${dropItemId || 0}`
  );
  session.log(
    `Gathering success node=${runtimeId} drop=${dropItemId || 0} map=${session.currentMapId}`
  );
  session.activeGather = null;
}

function maybeSendGatherFailureDialogue(session: GameSession, reason?: string): void {
  if (reason === 'missing-skill') {
    session.sendGameDialogue('Gathering', 'You have not learned the matching gathering skill yet.');
    return;
  }
  if (reason === 'no-tool-equipped' || reason === 'wrong-tool-type') {
    session.sendGameDialogue('Gathering', 'You need the correct gathering tool equipped first.');
  }
}
