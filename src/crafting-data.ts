'use strict';
export {};

const fs = require('fs');
const path = require('path');
const { resolveRepoPath } = require('./runtime-paths');
type UnknownRecord = Record<string, any>;

const CLIENT_DERIVED_ROOT = resolveRepoPath('data', 'client-derived');
const COMBINITEM_FILE = path.join(CLIENT_DERIVED_ROOT, 'combinitem.json');
const ITEMINFO_FILE = path.join(CLIENT_DERIVED_ROOT, 'iteminfo.json');
const STUFF_FILE = path.join(CLIENT_DERIVED_ROOT, 'stuff.json');

const COMBINITEM_ENTRIES = loadEntries(COMBINITEM_FILE);
const ITEMINFO_BY_TEMPLATE_ID = new Map(
  loadEntries(ITEMINFO_FILE)
    .filter((entry) => Number.isInteger(entry?.templateId))
    .map((entry) => [entry.templateId, entry])
);
const STUFF_BY_TEMPLATE_ID = new Map(
  loadEntries(STUFF_FILE)
    .filter((entry) => Number.isInteger(entry?.templateId))
    .map((entry) => [entry.templateId, entry])
);

function getComposeRecipesByMaterial(templateId: number): UnknownRecord[] {
  if (!Number.isInteger(templateId)) {
    return [];
  }
  return COMBINITEM_ENTRIES.filter((entry) => entry.materialTemplateId === templateId);
}

function getComposeRecipesByTarget(templateId: number): UnknownRecord[] {
  if (!Number.isInteger(templateId)) {
    return [];
  }
  return COMBINITEM_ENTRIES.filter((entry) => entry.targetTemplateId === templateId);
}

function getItemInfo(templateId: number): UnknownRecord | null {
  if (!Number.isInteger(templateId)) {
    return null;
  }
  return ITEMINFO_BY_TEMPLATE_ID.get(templateId) || null;
}

function getStuffDefinition(templateId: number): UnknownRecord | null {
  if (!Number.isInteger(templateId)) {
    return null;
  }
  return STUFF_BY_TEMPLATE_ID.get(templateId) || null;
}

function loadEntries(filePath: string): UnknownRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch (_err) {
    return [];
  }
}

module.exports = {
  getComposeRecipesByMaterial,
  getComposeRecipesByTarget,
  getItemInfo,
  getStuffDefinition,
};
