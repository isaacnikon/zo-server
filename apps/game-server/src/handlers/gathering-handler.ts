import { DEFAULT_FLAGS } from '../config.js';
import { buildActionStateResetPacket, buildActionStateTableResetPacket } from '../combat/packets.js';
import {
  decrementToolDurability,
  resolveGatheringSkillId,
  rollGatherLoot,
  validateGatherAccess,
} from '../gameplay/gathering-runtime.js';
import {
  sendEquipmentContainerSync,
  sendInventoryFullSync,
} from '../gameplay/inventory-runtime.js';
import { grantItemToBag } from '../inventory/index.js';
import { addSkillProficiency, resolveStoredSkillLevel } from '../gameplay/skill-runtime.js';
import {
  buildGatherFailedPacket,
  buildGatherRewardPacket,
  buildGatherStartConfirmPacket,
} from '../protocol/gameplay-packets.js';
import type { GameSession } from '../types.js';

const GATHER_START_SUBCMD = 0x0b;
const GATHER_COMPLETE_SUBCMD = 0x0d;

export async function handleGatheringRequest(session: GameSession, payload: Buffer): Promise<boolean> {
  if (payload.length < 3) {
    return false;
  }

  const subcmd = payload[2];
  if (subcmd === GATHER_START_SUBCMD) {
    handleGatherStart(session, payload);
    return true;
  }
  if (subcmd === GATHER_COMPLETE_SUBCMD) {
    await handleGatherComplete(session, payload);
    return true;
  }

  return false;
}

function handleGatherStart(session: GameSession, payload: Buffer): void {
  if (payload.length < 7) {
    session.writePacket(buildGatherFailedPacket(), DEFAULT_FLAGS, 'Gather start rejected: short payload');
    return;
  }

  const runtimeId = payload.readUInt32LE(3) >>> 0;
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

async function handleGatherComplete(session: GameSession, payload: Buffer): Promise<void> {
  if (payload.length < 7) {
    session.activeGather = null;
    session.writePacket(buildGatherFailedPacket(), DEFAULT_FLAGS, 'Gather complete rejected: short payload');
    clearClientGatherMode(session, 'short-payload');
    return;
  }

  const runtimeId = payload.readUInt32LE(3) >>> 0;
  if (!session.activeGather || (session.activeGather.runtimeId >>> 0) !== runtimeId) {
    session.log(
      `Gather complete rejected runtimeId=${runtimeId} expected=${session.activeGather?.runtimeId ?? 'none'} map=${session.currentMapId}`
    );
    session.activeGather = null;
    session.writePacket(buildGatherFailedPacket(), DEFAULT_FLAGS, 'Gather complete failed: runtime mismatch');
    clearClientGatherMode(session, 'runtime-mismatch');
    return;
  }

  const validation = validateGatherAccess(session, runtimeId);
  if (!validation.ok || !validation.node || !validation.bagItem) {
    session.activeGather = null;
    session.writePacket(buildGatherFailedPacket(), DEFAULT_FLAGS, `Gather complete failed reason=${validation.reason || 'unknown'}`);
    clearClientGatherMode(session, `validation-failed:${validation.reason || 'unknown'}`);
    return;
  }

  const skillId = resolveGatheringSkillId(validation.node.toolType);
  const skillLevel = skillId ? resolveStoredSkillLevel(session, skillId) : 1;
  const rolledItemIds = rollGatherLoot(validation.node, skillLevel);
  const grantedItemIds: number[] = [];
  let bagFull = false;
  for (const templateId of rolledItemIds) {
    const grantResult = grantItemToBag(session, templateId, 1);
    if (!grantResult?.ok) {
      if ((grantResult?.reason || '') === 'Bag is full') {
        bagFull = true;
        break;
      }
      continue;
    }
    grantedItemIds.push(templateId >>> 0);
  }

  if (grantedItemIds.length <= 0) {
    session.activeGather = null;
    session.writePacket(
      buildGatherFailedPacket(),
      DEFAULT_FLAGS,
      `Gather reward failed: ${bagFull ? 'bag full' : 'no rewards granted'} runtimeId=${runtimeId}`
    );
    if (bagFull) {
      session.sendGameDialogue('Gathering', 'Your pack is full.');
      clearClientGatherMode(session, 'bag-full');
    } else {
      clearClientGatherMode(session, 'grant-failed');
    }
    return;
  }

  let proficiencyResult: Record<string, any> | null = null;
  if (skillId) {
    proficiencyResult = addSkillProficiency(session, skillId, 1, 'gather-success', {
      syncMode: 'upgrade-only',
    });
  }

  const remainingDurability = decrementToolDurability(session, validation.bagItem);
  sendInventoryFullSync(session);
  if (remainingDurability <= 0) {
    sendEquipmentContainerSync(session);
  }
  await session.persistCurrentCharacter();

  session.writePacket(
    buildGatherRewardPacket(0),
    DEFAULT_FLAGS,
    `Gather reward runtimeId=${runtimeId} dropItemId=${grantedItemIds[0] || 0} bonus=${grantedItemIds.slice(1).join(',') || 'none'}`
  );
  session.log(
    `Gathering success node=${runtimeId} drops=${grantedItemIds.join(',')} map=${session.currentMapId} remainingDurability=${remainingDurability} skillId=${skillId || 0} proficiency=${proficiencyResult?.proficiency ?? 'n/a'}/${proficiencyResult?.threshold ?? 'n/a'} upgraded=${Array.isArray(proficiencyResult?.upgradedSkillIds) && proficiencyResult!.upgradedSkillIds.length > 0 ? proficiencyResult!.upgradedSkillIds.join(',') : 'none'}`
  );
  if (remainingDurability <= 0) {
    session.activeGather = null;
    clearClientGatherMode(session, `tool-broke:${runtimeId}`);
  }
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

function clearClientGatherMode(session: GameSession, reason: string): void {
  session.writePacket(
    buildActionStateResetPacket(session.runtimeId >>> 0),
    DEFAULT_FLAGS,
    `Sending gather action-state reset cmd=0x040d entity=${session.runtimeId} reason=${reason}`
  );
  session.writePacket(
    buildActionStateTableResetPacket(session.runtimeId >>> 0),
    DEFAULT_FLAGS,
    `Sending gather action-state table reset cmd=0x040d entity=${session.runtimeId} reason=${reason} entries=11`
  );
}
