#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { ensureDockerDatabaseReady, executeSqlViaDocker, resolvedProjectRoot, sha256Hex, toDocumentPath, walkJsonFiles } from './db-utils.js';
import { sqlInteger, sqlJson, sqlNullableInteger, sqlText, sqlTimestamp } from '../src/db/sql-literals.js';
import { buildCanonicalMapRoutes, type ManualTeleportOverrideFile, type MapTeleporterFile } from '../src/scenes/map-route-canonical.js';

type UnknownRecord = Record<string, any>;

const applyChanges = process.argv.includes('--apply');
const deleteFiles = process.argv.includes('--delete-files');

function loadJson(filePath: string): UnknownRecord | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as UnknownRecord;
  } catch {
    return null;
  }
}

function buildStaticDocumentSql(filePath: string): string | null {
  const raw = fs.readFileSync(filePath, 'utf8');
  const payload = JSON.parse(raw);
  const stat = fs.statSync(filePath);
  const documentPath = toDocumentPath(filePath);
  const documentGroup = documentPath.split('/').slice(0, 2).join('/') || 'data';

  return `INSERT INTO static_json_documents (
    document_path,
    document_group,
    payload,
    payload_sha256,
    source_size,
    source_mtime,
    imported_at
  ) VALUES (
    ${sqlText(documentPath)},
    ${sqlText(documentGroup)},
    ${sqlJson(payload)},
    ${sqlText(sha256Hex(raw))},
    ${sqlInteger(stat.size, 0)},
    ${sqlTimestamp(new Date(stat.mtimeMs).toISOString())},
    NOW()
  )
  ON CONFLICT (document_path) DO UPDATE
  SET document_group = EXCLUDED.document_group,
      payload = EXCLUDED.payload,
      payload_sha256 = EXCLUDED.payload_sha256,
      source_size = EXCLUDED.source_size,
      source_mtime = EXCLUDED.source_mtime,
      imported_at = NOW();`;
}

function buildItemImportSql(filePath: string): string[] {
  const parsed = loadJson(filePath);
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  const documentPath = toDocumentPath(filePath);
  const sourceName = path.basename(filePath, '.json');
  const itemKind = sourceName === 'equipment' || sourceName === 'weapons'
    ? (sourceName === 'equipment' ? 'armor' : 'weapon')
    : sourceName.replace(/s$/, '');
  const statements: string[] = [];
  for (const entry of entries) {
    if (!Number.isInteger(entry?.templateId)) {
      continue;
    }
    statements.push(
      `INSERT INTO game_item_definitions (
        template_id,
        source_document,
        item_kind,
        name,
        max_stack,
        container_type,
        client_template_family,
        equip_slot_field,
        sell_price,
        icon_path,
        raw_data,
        imported_at
      ) VALUES (
        ${sqlInteger(entry.templateId, 0)},
        ${sqlText(documentPath)},
        ${sqlText(itemKind)},
        ${sqlText(typeof entry?.name === 'string' ? entry.name : `Item ${entry.templateId}`)},
        ${sqlInteger(entry?.stackLimitField, 1)},
        1,
        ${Number.isInteger(entry?.clientTemplateFamily) ? sqlInteger(entry.clientTemplateFamily, 0) : 'NULL'},
        ${Number.isInteger(entry?.equipSlotField) ? sqlInteger(entry.equipSlotField, 0) : 'NULL'},
        ${Number.isInteger(entry?.sellPrice) ? sqlInteger(entry.sellPrice, 0) : 'NULL'},
        ${sqlText(typeof entry?.iconPath === 'string' ? entry.iconPath : '')},
        ${sqlJson(entry)},
        NOW()
      )
      ON CONFLICT (template_id) DO UPDATE
      SET source_document = EXCLUDED.source_document,
          item_kind = EXCLUDED.item_kind,
          name = EXCLUDED.name,
          max_stack = EXCLUDED.max_stack,
          container_type = EXCLUDED.container_type,
          client_template_family = EXCLUDED.client_template_family,
          equip_slot_field = EXCLUDED.equip_slot_field,
          sell_price = EXCLUDED.sell_price,
          icon_path = EXCLUDED.icon_path,
          raw_data = EXCLUDED.raw_data,
          imported_at = NOW();`
    );
  }
  return statements;
}

function buildSkillImportSql(filePath: string): string[] {
  const parsed = loadJson(filePath);
  const skills = Array.isArray(parsed?.skills) ? parsed.skills : [];
  const statements: string[] = [];
  for (const entry of skills) {
    if (!Number.isInteger(entry?.skillId)) {
      continue;
    }
    statements.push(
      `INSERT INTO game_skill_definitions (
        skill_id,
        template_id,
        name,
        required_level,
        required_attribute,
        required_attribute_value,
        behavior,
        implementation_class,
        selection_mode,
        follow_up_mode,
        allow_enemy_counterattack,
        is_passive,
        acquisition_source,
        raw_data,
        imported_at
      ) VALUES (
        ${sqlInteger(entry.skillId, 0)},
        ${Number.isInteger(entry?.templateId) ? sqlInteger(entry.templateId, 0) : 'NULL'},
        ${sqlText(typeof entry?.name === 'string' ? entry.name : `Skill ${entry.skillId}`)},
        ${Number.isInteger(entry?.requiredLevel) ? sqlInteger(entry.requiredLevel, 1) : 'NULL'},
        ${typeof entry?.requiredAttribute === 'string' ? sqlText(entry.requiredAttribute) : 'NULL'},
        ${Number.isInteger(entry?.requiredAttributeValue) ? sqlInteger(entry.requiredAttributeValue, 0) : 'NULL'},
        ${typeof entry?.behavior === 'string' ? sqlText(entry.behavior) : 'NULL'},
        ${Number.isInteger(entry?.implementationClass) ? sqlInteger(entry.implementationClass, 0) : 'NULL'},
        ${typeof entry?.selectionMode === 'string' ? sqlText(entry.selectionMode) : 'NULL'},
        ${typeof entry?.followUpMode === 'string' ? sqlText(entry.followUpMode) : 'NULL'},
        ${entry?.allowEnemyCounterattack === false ? 'FALSE' : 'TRUE'},
        ${entry?.isPassive === true ? 'TRUE' : 'FALSE'},
        ${typeof entry?.acquisitionSource === 'string' ? sqlText(entry.acquisitionSource) : 'NULL'},
        ${sqlJson(entry)},
        NOW()
      )
      ON CONFLICT (skill_id) DO UPDATE
      SET template_id = EXCLUDED.template_id,
          name = EXCLUDED.name,
          required_level = EXCLUDED.required_level,
          required_attribute = EXCLUDED.required_attribute,
          required_attribute_value = EXCLUDED.required_attribute_value,
          behavior = EXCLUDED.behavior,
          implementation_class = EXCLUDED.implementation_class,
          selection_mode = EXCLUDED.selection_mode,
          follow_up_mode = EXCLUDED.follow_up_mode,
          allow_enemy_counterattack = EXCLUDED.allow_enemy_counterattack,
          is_passive = EXCLUDED.is_passive,
          acquisition_source = EXCLUDED.acquisition_source,
          raw_data = EXCLUDED.raw_data,
          imported_at = NOW();`
    );
  }
  return statements;
}

function buildQuestImportSql(filePath: string): string[] {
  const parsed = loadJson(filePath);
  const quests = Array.isArray(parsed?.quests) ? parsed.quests : [];
  const statements: string[] = [];
  for (const quest of quests) {
    if (!Number.isInteger(quest?.id)) {
      continue;
    }
    statements.push(
      `INSERT INTO game_quest_definitions (
        quest_id,
        name,
        category,
        accept_npc_id,
        min_level,
        repeatable,
        next_quest_id,
        raw_data,
        imported_at
      ) VALUES (
        ${sqlInteger(quest.id, 0)},
        ${sqlText(typeof quest?.name === 'string' ? quest.name : `Quest ${quest.id}`)},
        ${sqlText(typeof quest?.category === 'string' ? quest.category : 'unknown')},
        ${Number.isInteger(quest?.acceptNpcId) ? sqlInteger(quest.acceptNpcId, 0) : 'NULL'},
        ${sqlInteger(quest?.minLevel, 1)},
        ${quest?.repeatable === true ? 'TRUE' : 'FALSE'},
        ${Number.isInteger(quest?.nextQuestId) ? sqlInteger(quest.nextQuestId, 0) : 'NULL'},
        ${sqlJson(quest)},
        NOW()
      )
      ON CONFLICT (quest_id) DO UPDATE
      SET name = EXCLUDED.name,
          category = EXCLUDED.category,
          accept_npc_id = EXCLUDED.accept_npc_id,
          min_level = EXCLUDED.min_level,
          repeatable = EXCLUDED.repeatable,
          next_quest_id = EXCLUDED.next_quest_id,
          raw_data = EXCLUDED.raw_data,
          imported_at = NOW();`
    );
  }
  return statements;
}

function buildQuestTasklistImportSql(filePath: string): string[] {
  const parsed = loadJson(filePath);
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  const statements: string[] = [];
  for (const entry of entries) {
    if (!Number.isInteger(entry?.taskId)) {
      continue;
    }
    statements.push(
      `INSERT INTO game_quest_tasklist (
        task_id,
        start_npc_id,
        title,
        field11,
        raw_data,
        imported_at
      ) VALUES (
        ${sqlInteger(entry.taskId, 0)},
        ${sqlInteger(entry?.startNpcId, 0)},
        ${sqlText(typeof entry?.title === 'string' ? entry.title : '')},
        ${sqlInteger(entry?.field11, 0)},
        ${sqlJson(entry)},
        NOW()
      )
      ON CONFLICT (task_id) DO UPDATE
      SET start_npc_id = EXCLUDED.start_npc_id,
          title = EXCLUDED.title,
          field11 = EXCLUDED.field11,
          raw_data = EXCLUDED.raw_data,
          imported_at = NOW();`
    );
  }
  return statements;
}

function buildMapImportSql(filePath: string): string[] {
  const parsed = loadJson(filePath);
  const maps = Array.isArray(parsed?.maps) ? parsed.maps : [];
  const summary = parsed?.summary && typeof parsed.summary === 'object' ? parsed.summary : {};
  const statements: string[] = [];
  for (const entry of maps) {
    if (!Number.isInteger(entry?.mapId)) {
      continue;
    }
    statements.push(
      `INSERT INTO game_map_summaries (
        map_id,
        map_name,
        summary_data,
        raw_data,
        imported_at
      ) VALUES (
        ${sqlInteger(entry.mapId, 0)},
        ${sqlText(typeof entry?.mapName === 'string' ? entry.mapName : `Map ${entry.mapId}`)},
        ${sqlJson(summary)},
        ${sqlJson(entry)},
        NOW()
      )
      ON CONFLICT (map_id) DO UPDATE
      SET map_name = EXCLUDED.map_name,
          summary_data = EXCLUDED.summary_data,
          raw_data = EXCLUDED.raw_data,
          imported_at = NOW();`
    );
  }
  return statements;
}

function buildNpcShopImportSql(filePath: string): string[] {
  const parsed = loadJson(filePath);
  const defaultsByNpcId = parsed?.defaultsByNpcId && typeof parsed.defaultsByNpcId === 'object'
    ? parsed.defaultsByNpcId
    : {};
  const statements: string[] = [];
  for (const [npcIdText, shop] of Object.entries(defaultsByNpcId)) {
    const npcId = Number(npcIdText);
    if (!Number.isInteger(npcId)) {
      continue;
    }
    statements.push(
      `INSERT INTO game_npc_shops (
        npc_id,
        speaker,
        shop_data,
        raw_data,
        imported_at
      ) VALUES (
        ${sqlInteger(npcId, 0)},
        ${sqlText(typeof (shop as UnknownRecord)?.speaker === 'string' ? (shop as UnknownRecord).speaker : '')},
        ${sqlJson((shop as UnknownRecord)?.items || [])},
        ${sqlJson(shop)},
        NOW()
      )
      ON CONFLICT (npc_id) DO UPDATE
      SET speaker = EXCLUDED.speaker,
          shop_data = EXCLUDED.shop_data,
          raw_data = EXCLUDED.raw_data,
          imported_at = NOW();`
    );
  }
  return statements;
}

function buildRoleImportSql(filePath: string): string[] {
  const parsed = loadJson(filePath);
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  const statements: string[] = [];
  for (const entry of entries) {
    if (!Number.isInteger(entry?.roleId)) {
      continue;
    }
    statements.push(
      `INSERT INTO game_role_definitions (
        role_id,
        name,
        role_class_field,
        map_id,
        raw_data,
        imported_at
      ) VALUES (
        ${sqlInteger(entry.roleId, 0)},
        ${sqlText(typeof entry?.name === 'string' ? entry.name : `Role ${entry.roleId}`)},
        ${Number.isInteger(entry?.roleClassField) ? sqlInteger(entry.roleClassField, 0) : 'NULL'},
        ${Number.isInteger(entry?.mapId) ? sqlInteger(entry.mapId, 0) : 'NULL'},
        ${sqlJson(entry)},
        NOW()
      )
      ON CONFLICT (role_id) DO UPDATE
      SET name = EXCLUDED.name,
          role_class_field = EXCLUDED.role_class_field,
          map_id = EXCLUDED.map_id,
          raw_data = EXCLUDED.raw_data,
          imported_at = NOW();`
    );
  }
  return statements;
}

function buildMapRouteSeedSql(mapTeleporterFilePath: string, overrideFilePath: string): string[] {
  const teleporterDocument = loadJson(mapTeleporterFilePath) as MapTeleporterFile | null;
  const overrideDocument = loadJson(overrideFilePath) as ManualTeleportOverrideFile | null;
  const routes = buildCanonicalMapRoutes(teleporterDocument, overrideDocument || {});
  const statements: string[] = [];

  for (const route of routes) {
    statements.push(
      `INSERT INTO game_map_routes (
        source_map_id,
        source_scene_script_id,
        display_label,
        trigger_min_x,
        trigger_max_x,
        trigger_min_y,
        trigger_max_y,
        target_map_id,
        target_scene_script_id,
        target_x,
        target_y,
        validation_status,
        updated_at
      ) VALUES (
        ${sqlInteger(route.sourceMapId, 0)},
        ${sqlInteger(route.sourceSceneScriptId, 0)},
        ${sqlText(route.displayLabel)},
        ${sqlInteger(route.trigger.minX, 0)},
        ${sqlInteger(route.trigger.maxX, 0)},
        ${sqlInteger(route.trigger.minY, 0)},
        ${sqlInteger(route.trigger.maxY, 0)},
        ${sqlInteger(route.targetMapId, 0)},
        ${sqlNullableInteger(route.targetSceneScriptId)},
        ${sqlInteger(route.targetX, 0)},
        ${sqlInteger(route.targetY, 0)},
        ${sqlText(route.validation || 'unknown')},
        NOW()
      )
      ON CONFLICT (source_map_id, source_scene_script_id) DO NOTHING;`
    );
  }

  return statements;
}

function buildCuratedImportSql(): string[] {
  const statements = [
    'DELETE FROM game_item_definitions;',
    'DELETE FROM game_skill_definitions;',
    'DELETE FROM game_quest_definitions;',
    'DELETE FROM game_quest_tasklist;',
    'DELETE FROM game_map_summaries;',
    'DELETE FROM game_npc_shops;',
    'DELETE FROM game_role_definitions;',
  ];

  const itemFiles = [
    'data/client-derived/items.json',
    'data/client-derived/potions.json',
    'data/client-derived/stuff.json',
    'data/client-derived/equipment.json',
    'data/client-derived/weapons.json',
  ].map((relativePath) => path.join(resolvedProjectRoot, relativePath));

  for (const filePath of itemFiles) {
    if (fs.existsSync(filePath)) {
      statements.push(...buildItemImportSql(filePath));
    }
  }

  const skillFile = path.join(resolvedProjectRoot, 'data/skills.json');
  if (fs.existsSync(skillFile)) {
    statements.push(...buildSkillImportSql(skillFile));
  }

  const questCatalogFile = path.join(resolvedProjectRoot, 'data/quests/catalog.json');
  if (fs.existsSync(questCatalogFile)) {
    statements.push(...buildQuestImportSql(questCatalogFile));
  }

  const questTasklistFile = path.join(resolvedProjectRoot, 'data/client-derived/quests.json');
  if (fs.existsSync(questTasklistFile)) {
    statements.push(...buildQuestTasklistImportSql(questTasklistFile));
  }

  const mapSummaryFile = path.join(resolvedProjectRoot, 'data/client-derived/maps/map-summary.json');
  if (fs.existsSync(mapSummaryFile)) {
    statements.push(...buildMapImportSql(mapSummaryFile));
  }

  const mapTeleporterFile = path.join(resolvedProjectRoot, 'data/client-derived/maps/map-teleporters.json');
  const teleportOverrideFile = path.join(resolvedProjectRoot, 'data/teleport-route-overrides.json');
  if (fs.existsSync(mapTeleporterFile) && fs.existsSync(teleportOverrideFile)) {
    statements.push(...buildMapRouteSeedSql(mapTeleporterFile, teleportOverrideFile));
  }

  const npcShopFile = path.join(resolvedProjectRoot, 'data/client-derived/npc-shops.json');
  if (fs.existsSync(npcShopFile)) {
    statements.push(...buildNpcShopImportSql(npcShopFile));
  }

  const roleFile = path.join(resolvedProjectRoot, 'data/client-derived/roleinfo.json');
  if (fs.existsSync(roleFile)) {
    statements.push(...buildRoleImportSql(roleFile));
  }

  return statements;
}

async function main(): Promise<void> {
  const dataRoot = path.join(resolvedProjectRoot, 'data');
  const files = walkJsonFiles(dataRoot, {
    excludeDirs: new Set(['save', 'runtime']),
  });
  const sqlStatements = ['BEGIN;'];
  for (const filePath of files) {
    sqlStatements.push(buildStaticDocumentSql(filePath)!);
  }
  sqlStatements.push(...buildCuratedImportSql());
  sqlStatements.push('COMMIT;');

  if (!applyChanges) {
    process.stdout.write(
      `Dry run: ${files.length} static JSON documents ready for import. Re-run with --apply to write to Postgres.\n`
    );
    return;
  }

  await ensureDockerDatabaseReady();
  await executeSqlViaDocker(sqlStatements.join('\n'));
  process.stdout.write(`Imported ${files.length} static JSON documents into Postgres.\n`);

  if (!deleteFiles) {
    return;
  }

  for (const filePath of files) {
    fs.unlinkSync(filePath);
  }
  process.stdout.write(`Deleted ${files.length} static JSON files after import.\n`);
}

await main();
