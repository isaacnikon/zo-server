import fs from 'node:fs';

import { tryReadStaticJsonDocument } from '../db/static-json-store.js';
import { getEquippedItems, getItemDefinition } from '../inventory/index.js';
import { resolveRepoPath } from '../runtime-paths.js';
import type { GameSession } from '../types.js';

const VERIFIED_GATHERING_NODES_FILE = resolveRepoPath('data', 'client-verified', 'gathering-nodes.json');
const DERIVED_GATHERING_NODES_FILE = resolveRepoPath('data', 'client-derived', 'gathering-nodes.json');
const ROLEINFO_FILE = resolveRepoPath('data', 'client-derived', 'archive', '0000136e__roleinfo.txt');

const TOOL_TYPE_TO_SKILL_ID: Record<number, number> = {
  9006: 9006,
  9007: 9007,
  9008: 9008,
  9009: 9009,
};

const MINING_TOOL_TYPE = 9006;
const LUMBERING_TOOL_TYPE = 9007;
const HERBALISM_TOOL_TYPE = 9008;
const GATHER_DURABILITY_COST = 30;

// Until client-authored gather bonus rates are recovered, keep these easy to tune.
const GATHER_JADE_BONUS_CHANCE_PERCENT = 10;
const GATHER_SPAR_BONUS_CHANCE_PERCENT = 10;
const GATHER_CRYSTAL_BONUS_CHANCE_PERCENT = 10;
const JADE_TEMPLATE_IDS_BY_LEVEL = [
  23045, 23046, 23047, 23048, 23049,
  23050, 23051, 23052, 23053, 23054,
];
const SPAR_TEMPLATE_IDS_BY_LEVEL = [
  23121, 23122, 23123, 23124, 23125,
  23126, 23127, 23128, 23129, 23130,
];
const CRYSTAL_TEMPLATE_IDS_BY_LEVEL = [
  23055, 23056, 23057, 23058, 23059,
  23060, 23061, 23062, 23063, 23064,
];

type GatheringMaterial = {
  nodeTemplateId: number;
  name: string;
  level: number;
  toolType: number;
  dropItemId: number;
};

type VerifiedGatheringDocument = {
  maps?: Array<{
    mapId?: number;
    nodes?: Array<{
      nodeId?: number;
      nodeTemplateId?: number;
      x?: number;
      y?: number;
    }>;
  }>;
};

type DerivedGatheringDocument = {
  materials?: GatheringMaterial[];
  mapNodes?: Array<{
    mapId?: number;
    nodeTemplateId?: number;
    x?: number;
    y?: number;
  }>;
};

type MapNodePlacement = {
  mapId: number;
  nodeTemplateId: number;
  x: number;
  y: number;
};

type GatherToolMatch = {
  bagItem: any;
  toolType: number;
};

export interface ActiveGatheringNode {
  runtimeId: number;
  nodeId: number;
  templateId: number;
  x: number;
  y: number;
  toolType: number;
  dropItemId: number;
  level: number;
  name: string;
}

export interface GatherValidation {
  ok: boolean;
  reason?: string;
  node?: ActiveGatheringNode;
  bagItem?: any;
  toolType?: number;
}

let cachedMaterialsByTemplateId: Map<number, GatheringMaterial> | null = null;
let cachedPlacementsByMapId: Map<number, MapNodePlacement[]> | null = null;

function readJsonFile<T>(filePath: string): T | null {
  return tryReadStaticJsonDocument<T>(filePath);
}

function loadMaterialsByTemplateId(): Map<number, GatheringMaterial> {
  if (cachedMaterialsByTemplateId) {
    return cachedMaterialsByTemplateId;
  }

  const derived = readJsonFile<DerivedGatheringDocument>(DERIVED_GATHERING_NODES_FILE);
  const fromDerived = Array.isArray(derived?.materials)
    ? derived!.materials.filter((entry) =>
        Number.isInteger(entry?.nodeTemplateId) &&
        Number.isInteger(entry?.toolType) &&
        Number.isInteger(entry?.dropItemId)
      )
    : [];

  const byTemplateId = new Map<number, GatheringMaterial>();
  if (fromDerived.length > 0) {
    for (const entry of fromDerived) {
      byTemplateId.set(entry.nodeTemplateId >>> 0, {
        nodeTemplateId: entry.nodeTemplateId >>> 0,
        name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : `Node ${entry.nodeTemplateId}`,
        level: Number.isInteger(entry.level) ? Math.max(1, entry.level >>> 0) : 1,
        toolType: entry.toolType >>> 0,
        dropItemId: entry.dropItemId >>> 0,
      });
    }
    cachedMaterialsByTemplateId = byTemplateId;
    return byTemplateId;
  }

  const lines = readRoleinfoLines();
  for (const line of lines) {
    const parts = parseCsvLine(line);
    if (parts.length < 9) {
      continue;
    }
    const nodeTemplateId = Number(parts[1] || 0);
    const entryType = Number(parts[2] || 0);
    const level = Number(parts[4] || 0);
    const toolType = Number(parts[5] || 0);
    const dropItemId = Number(parts[7] || 0);
    if (!Number.isInteger(nodeTemplateId) || nodeTemplateId < 10001 || nodeTemplateId > 10099 || entryType !== 8) {
      continue;
    }
    if (!Number.isInteger(toolType) || !Number.isInteger(dropItemId) || toolType <= 0 || dropItemId <= 0) {
      continue;
    }
    byTemplateId.set(nodeTemplateId >>> 0, {
      nodeTemplateId: nodeTemplateId >>> 0,
      name: parts[0] || `Node ${nodeTemplateId}`,
      level: Number.isInteger(level) && level > 0 ? level >>> 0 : 1,
      toolType: toolType >>> 0,
      dropItemId: dropItemId >>> 0,
    });
  }

  cachedMaterialsByTemplateId = byTemplateId;
  return byTemplateId;
}

function loadPlacementsByMapId(): Map<number, MapNodePlacement[]> {
  if (cachedPlacementsByMapId) {
    return cachedPlacementsByMapId;
  }

  const byMapId = new Map<number, MapNodePlacement[]>();
  const derived = readJsonFile<DerivedGatheringDocument>(DERIVED_GATHERING_NODES_FILE);
  const derivedPlacements = Array.isArray(derived?.mapNodes) ? derived!.mapNodes : [];
  if (derivedPlacements.length > 0) {
    for (const entry of derivedPlacements) {
      const mapId = Number(entry?.mapId || 0);
      const nodeTemplateId = Number(entry?.nodeTemplateId || 0);
      const x = Number(entry?.x || 0);
      const y = Number(entry?.y || 0);
      if (!Number.isInteger(mapId) || !Number.isInteger(nodeTemplateId) || !Number.isInteger(x) || !Number.isInteger(y)) {
        continue;
      }
      pushPlacement(byMapId, {
        mapId: mapId >>> 0,
        nodeTemplateId: nodeTemplateId >>> 0,
        x: x >>> 0,
        y: y >>> 0,
      });
    }
  }

  if (byMapId.size === 0) {
    const verified = readJsonFile<VerifiedGatheringDocument>(VERIFIED_GATHERING_NODES_FILE);
    const maps = Array.isArray(verified?.maps) ? verified!.maps : [];
    for (const mapEntry of maps) {
      const mapId = Number(mapEntry?.mapId || 0);
      if (!Number.isInteger(mapId) || mapId <= 0) {
        continue;
      }
      const nodes = Array.isArray(mapEntry?.nodes) ? mapEntry!.nodes : [];
      for (const node of nodes) {
        const nodeTemplateId = Number(node?.nodeTemplateId ?? node?.nodeId ?? 0);
        const x = Number(node?.x || 0);
        const y = Number(node?.y || 0);
        if (!Number.isInteger(nodeTemplateId) || !Number.isInteger(x) || !Number.isInteger(y) || nodeTemplateId <= 0) {
          continue;
        }
        pushPlacement(byMapId, {
          mapId: mapId >>> 0,
          nodeTemplateId: nodeTemplateId >>> 0,
          x: x >>> 0,
          y: y >>> 0,
        });
      }
    }
  }

  cachedPlacementsByMapId = byMapId;
  return byMapId;
}

function pushPlacement(byMapId: Map<number, MapNodePlacement[]>, placement: MapNodePlacement): void {
  const existing = byMapId.get(placement.mapId) || [];
  existing.push(placement);
  byMapId.set(placement.mapId, existing);
}

function readRoleinfoLines(): string[] {
  try {
    return fs.readFileSync(ROLEINFO_FILE, 'utf8').split(/\r?\n/);
  } catch {
    return [];
  }
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function buildGatheringRuntimeId(mapId: number, index: number): number {
  return (((mapId & 0xffff) << 16) | (0x8000 + ((index + 1) & 0x7fff))) >>> 0;
}

export function buildMapGatheringNodes(mapId: number): Map<number, ActiveGatheringNode> {
  const placements = loadPlacementsByMapId().get(mapId >>> 0) || [];
  const materialsByTemplateId = loadMaterialsByTemplateId();
  const result = new Map<number, ActiveGatheringNode>();

  placements.forEach((placement, index) => {
    const material = materialsByTemplateId.get(placement.nodeTemplateId >>> 0);
    if (!material) {
      return;
    }
    const runtimeId = buildGatheringRuntimeId(mapId, index);
    result.set(runtimeId, {
      runtimeId,
      nodeId: material.nodeTemplateId,
      templateId: material.nodeTemplateId,
      x: placement.x,
      y: placement.y,
      toolType: material.toolType,
      dropItemId: material.dropItemId,
      level: material.level,
      name: material.name,
    });
  });

  return result;
}

export function resolveGatheringSkillId(toolType: number): number | null {
  const skillId = TOOL_TYPE_TO_SKILL_ID[toolType >>> 0];
  return Number.isInteger(skillId) && skillId > 0 ? skillId : null;
}

export function resolveGatheringToolType(session: GameSession): number | null {
  const tool = resolveEquippedGatheringTool(session);
  return tool?.toolType ?? null;
}

function resolveEquippedGatheringTool(session: GameSession): GatherToolMatch | null {
  const equippedItems = getEquippedItems(session as any);
  for (const bagItem of equippedItems) {
    const definition = getItemDefinition(Number(bagItem?.templateId || 0));
    const combatStats = definition?.combatStats && typeof definition.combatStats === 'object'
      ? definition.combatStats
      : null;
    const rawStats = Array.isArray((combatStats as any)?.raw) ? (combatStats as any).raw : [];
    const toolType = Number(rawStats[14] || 0);
    if (toolType >= 9006 && toolType <= 9009) {
      const durability = Number.isInteger(bagItem?.durability)
        ? Number(bagItem.durability)
        : Number.isInteger(bagItem?.quantity)
          ? Number(bagItem.quantity)
          : 0;
      if (durability <= 0) {
        continue;
      }
      return { bagItem, toolType: toolType >>> 0 };
    }
  }
  return null;
}

function hasGatheringSkill(session: GameSession, skillId: number): boolean {
  const learnedSkills = Array.isArray(session.skillState?.learnedSkills)
    ? session.skillState.learnedSkills
    : [];
  return learnedSkills.some((entry) => Number(entry?.skillId || 0) === (skillId >>> 0));
}

export function validateGatherAccess(session: GameSession, runtimeId: number): GatherValidation {
  const gatheringNodes = session.gatheringNodes;
  if (!(gatheringNodes instanceof Map)) {
    return { ok: false, reason: 'no-nodes' };
  }

  const node = gatheringNodes.get(runtimeId >>> 0);
  if (!node) {
    return { ok: false, reason: 'node-not-found' };
  }

  const equippedTool = resolveEquippedGatheringTool(session);
  if (!equippedTool) {
    return { ok: false, reason: 'no-tool-equipped', node };
  }
  if ((equippedTool.toolType >>> 0) !== (node.toolType >>> 0)) {
    return { ok: false, reason: 'wrong-tool-type', node, toolType: equippedTool.toolType, bagItem: equippedTool.bagItem };
  }

  const requiredSkillId = resolveGatheringSkillId(node.toolType);
  if (!requiredSkillId || !hasGatheringSkill(session, requiredSkillId)) {
    return { ok: false, reason: 'missing-skill', node, toolType: equippedTool.toolType, bagItem: equippedTool.bagItem };
  }

  return {
    ok: true,
    node,
    bagItem: equippedTool.bagItem,
    toolType: equippedTool.toolType,
  };
}

export function rollGatherLoot(node: ActiveGatheringNode, _skillLevel: number): number[] {
  const rewards: number[] = [];
  if (Number.isInteger(node?.dropItemId) && (node.dropItemId >>> 0) > 0) {
    rewards.push(node.dropItemId >>> 0);
  }

  const tierIndex = Math.max(0, Math.min(9, (Number(node?.level || 1) | 0) - 1));
  if (
    (node?.toolType >>> 0) === MINING_TOOL_TYPE &&
    (Math.random() * 100) < GATHER_CRYSTAL_BONUS_CHANCE_PERCENT
  ) {
    rewards.push(CRYSTAL_TEMPLATE_IDS_BY_LEVEL[tierIndex] >>> 0);
  }
  if (
    (node?.toolType >>> 0) === HERBALISM_TOOL_TYPE &&
    (Math.random() * 100) < GATHER_SPAR_BONUS_CHANCE_PERCENT
  ) {
    rewards.push(SPAR_TEMPLATE_IDS_BY_LEVEL[tierIndex] >>> 0);
  }
  if (
    (node?.toolType >>> 0) === LUMBERING_TOOL_TYPE &&
    (Math.random() * 100) < GATHER_JADE_BONUS_CHANCE_PERCENT
  ) {
    rewards.push(JADE_TEMPLATE_IDS_BY_LEVEL[tierIndex] >>> 0);
  }

  return rewards;
}

export function decrementToolDurability(_session: GameSession, bagItem: any): number {
  const currentDurability = Number.isInteger(bagItem?.durability)
    ? Number(bagItem.durability)
    : Number.isInteger(bagItem?.quantity)
      ? Number(bagItem.quantity)
      : 0;
  const nextDurability = Math.max(0, currentDurability - GATHER_DURABILITY_COST);

  bagItem.durability = nextDurability;

  if (nextDurability <= 0) {
    bagItem.equipped = false;
    return 0;
  }

  return nextDurability;
}
