import fs from 'node:fs';
import path from 'node:path';

import { STATIC_DATA_BACKEND } from '../config.js';
import { queryPostgres } from './postgres-pool.js';
import { resolveRepoPath } from '../runtime-paths.js';

const DOCUMENT_CACHE = new Map<string, unknown | null>();
const VERSION_CACHE = new Map<string, string>();
let staticJsonStoreInitialized = false;
let staticJsonStoreInitPromise: Promise<void> | null = null;

type StaticJsonRow = {
  document_path: string;
  payload: unknown;
  payload_sha256: string | null;
  source_size: number | null;
  source_mtime_epoch: string | null;
};

function toDocumentPath(filePath: string): string {
  const projectRoot = resolveRepoPath();
  const absolutePath = path.isAbsolute(filePath) ? filePath : resolveRepoPath(filePath);
  const relativePath = path.relative(projectRoot, absolutePath);
  return relativePath.startsWith('..')
    ? absolutePath.split(path.sep).join('/')
    : relativePath.split(path.sep).join('/');
}

function readFromFilesystem<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function buildVersionToken(row: Pick<StaticJsonRow, 'payload_sha256' | 'source_size' | 'source_mtime_epoch'>): string {
  return `${row.payload_sha256 || ''}:${Number(row.source_size || 0)}:${row.source_mtime_epoch || '0'}`;
}

async function loadStaticJsonRowsFromDatabase(): Promise<StaticJsonRow[]> {
  const result = await queryPostgres<StaticJsonRow>(
    `SELECT
       document_path,
       payload,
       payload_sha256,
       source_size,
       COALESCE(EXTRACT(EPOCH FROM source_mtime)::bigint::text, '0') AS source_mtime_epoch
     FROM static_json_documents`
  );
  return result.rows;
}

function cacheStaticJsonRows(rows: StaticJsonRow[]): void {
  DOCUMENT_CACHE.clear();
  VERSION_CACHE.clear();
  for (const row of rows) {
    if (typeof row?.document_path !== 'string' || row.document_path.length < 1) {
      continue;
    }
    DOCUMENT_CACHE.set(row.document_path, row.payload ?? null);
    VERSION_CACHE.set(row.document_path, buildVersionToken(row));
  }
}

export async function initializeStaticJsonStore(forceReload = false): Promise<void> {
  if (STATIC_DATA_BACKEND !== 'db') {
    staticJsonStoreInitialized = true;
    return;
  }

  if (forceReload) {
    staticJsonStoreInitialized = false;
    staticJsonStoreInitPromise = null;
  }

  if (staticJsonStoreInitialized) {
    return;
  }
  if (!staticJsonStoreInitPromise) {
    staticJsonStoreInitPromise = loadStaticJsonRowsFromDatabase()
      .then((rows) => {
        cacheStaticJsonRows(rows);
        staticJsonStoreInitialized = true;
      })
      .finally(() => {
        staticJsonStoreInitPromise = null;
      });
  }
  await staticJsonStoreInitPromise;
}

export function tryReadStaticJsonDocument<T>(filePath: string): T | null {
  const absolutePath = path.isAbsolute(filePath) ? filePath : resolveRepoPath(filePath);
  const documentPath = toDocumentPath(absolutePath);
  if (DOCUMENT_CACHE.has(documentPath)) {
    return (DOCUMENT_CACHE.get(documentPath) || null) as T | null;
  }

  if (STATIC_DATA_BACKEND === 'db' && !staticJsonStoreInitialized && !staticJsonStoreInitPromise) {
    void initializeStaticJsonStore().catch(() => {
      // Fall back to filesystem below.
    });
  }
  const fromDatabase =
    STATIC_DATA_BACKEND === 'db' ? ((DOCUMENT_CACHE.get(documentPath) || null) as T | null) : null;
  if (fromDatabase != null) {
    DOCUMENT_CACHE.set(documentPath, fromDatabase);
    return fromDatabase;
  }

  const fromFilesystem = readFromFilesystem<T>(absolutePath);
  DOCUMENT_CACHE.set(documentPath, fromFilesystem);
  return fromFilesystem;
}

export function readStaticJsonDocument<T>(filePath: string): T {
  const document = tryReadStaticJsonDocument<T>(filePath);
  if (document == null) {
    throw new Error(`Static JSON document not found: ${toDocumentPath(filePath)}`);
  }
  return document;
}

export function getStaticJsonVersionToken(filePath: string): string {
  const absolutePath = path.isAbsolute(filePath) ? filePath : resolveRepoPath(filePath);
  const documentPath = toDocumentPath(absolutePath);
  if (VERSION_CACHE.has(documentPath)) {
    return VERSION_CACHE.get(documentPath)!;
  }

  if (STATIC_DATA_BACKEND === 'db' && !staticJsonStoreInitialized && !staticJsonStoreInitPromise) {
    void initializeStaticJsonStore().catch(() => {
      // Fall back to filesystem below.
    });
  }
  if (STATIC_DATA_BACKEND === 'db' && VERSION_CACHE.has(documentPath)) {
    return VERSION_CACHE.get(documentPath)!;
  }

  try {
    const stat = fs.statSync(absolutePath);
    const token = `${stat.mtimeMs}:${stat.size}`;
    VERSION_CACHE.set(documentPath, token);
    return token;
  } catch {
    VERSION_CACHE.set(documentPath, 'missing');
    return 'missing';
  }
}
