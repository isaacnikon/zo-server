import fs from 'node:fs';
import path from 'node:path';

import { STATIC_DATA_BACKEND } from '../config.js';
import { queryOptionalScalar } from './postgres-cli.js';
import { sqlText } from './sql-literals.js';
import { resolveRepoPath } from '../runtime-paths.js';

const DOCUMENT_CACHE = new Map<string, unknown | null>();
const VERSION_CACHE = new Map<string, string>();

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

function readFromDatabase<T>(documentPath: string): T | null {
  try {
    const payload = queryOptionalScalar(
      `SELECT payload::text FROM static_json_documents WHERE document_path = ${sqlText(documentPath)}`
    );
    return payload ? (JSON.parse(payload) as T) : null;
  } catch {
    return null;
  }
}

export function tryReadStaticJsonDocument<T>(filePath: string): T | null {
  const absolutePath = path.isAbsolute(filePath) ? filePath : resolveRepoPath(filePath);
  const documentPath = toDocumentPath(absolutePath);
  if (DOCUMENT_CACHE.has(documentPath)) {
    return (DOCUMENT_CACHE.get(documentPath) || null) as T | null;
  }

  const fromDatabase =
    STATIC_DATA_BACKEND === 'db' ? readFromDatabase<T>(documentPath) : null;
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

  if (STATIC_DATA_BACKEND === 'db') {
    try {
      const token = queryOptionalScalar(
        `SELECT payload_sha256 || ':' || source_size::text || ':' || COALESCE(EXTRACT(EPOCH FROM source_mtime)::bigint::text, '0')
         FROM static_json_documents
         WHERE document_path = ${sqlText(documentPath)}`
      );
      if (token) {
        VERSION_CACHE.set(documentPath, token);
        return token;
      }
    } catch {
      // Fall back to filesystem below.
    }
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
