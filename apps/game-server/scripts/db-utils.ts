import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { resolveRepoPath } from '../src/runtime-paths.js';

const require = createRequire(import.meta.url);
const { Client } = require('pg') as {
  Client: new (config: ClientConfig) => {
    connect(): Promise<void>;
    query(sql: string): Promise<unknown>;
    end(): Promise<void>;
  };
};

export type ClientConfig = {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
};

export const resolvedProjectRoot = resolveRepoPath();

function runDockerCompose(args: string[], input?: string): string {
  try {
    return execFileSync('docker', ['compose', ...args], {
      cwd: resolvedProjectRoot,
      encoding: 'utf8',
      input,
    });
  } catch (error: any) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
    throw new Error(stderr || stdout || error?.message || `docker compose ${args.join(' ')} failed`);
  }
}

function resolveDirectDatabaseConfig(): ClientConfig | null {
  const connectionString = process.env.DATABASE_URL || process.env.PGURL || null;
  const host = process.env.DATABASE_HOST || process.env.PGHOST || process.env.POSTGRES_HOST || null;
  if (!connectionString && !host) {
    return null;
  }

  const portValue = process.env.DATABASE_PORT || process.env.PGPORT || process.env.POSTGRES_PORT || '5432';
  const port = Number.parseInt(portValue, 10);
  return {
    connectionString: connectionString || undefined,
    host: connectionString ? undefined : host || undefined,
    port: connectionString ? undefined : (Number.isFinite(port) ? port : 5432),
    database: process.env.DATABASE_NAME || process.env.PGDATABASE || process.env.POSTGRES_DB || 'zo_server',
    user: process.env.DATABASE_USER || process.env.PGUSER || process.env.POSTGRES_USER || 'zo',
    password: process.env.DATABASE_PASSWORD || process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'zo_password',
  };
}

async function waitForDirectDatabaseReady(config: ClientConfig): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const client = new Client(config);
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      try {
        await client.end();
      } catch {
        // Ignore cleanup failures while waiting for the database to come up.
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Database did not become ready in time.');
}

export async function ensureDockerDatabaseReady(): Promise<void> {
  const directConfig = resolveDirectDatabaseConfig();
  if (directConfig) {
    await waitForDirectDatabaseReady(directConfig);
    return;
  }
  runDockerCompose(['up', '-d', 'postgres']);
  runDockerCompose(['run', '--rm', 'flyway', 'migrate']);
}

export async function executeSqlViaDocker(sql: string): Promise<void> {
  const directConfig = resolveDirectDatabaseConfig();
  if (directConfig) {
    const client = new Client(directConfig);
    await client.connect();
    try {
      await client.query(sql);
      return;
    } finally {
      await client.end();
    }
  }
  runDockerCompose(
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      process.env.POSTGRES_USER || 'zo',
      '-d',
      process.env.POSTGRES_DB || 'zo_server',
      '-f',
      '-',
    ],
    sql
  );
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function walkJsonFiles(rootPath: string, options: { excludeDirs?: Set<string> } = {}): string[] {
  const results: string[] = [];
  if (!fs.existsSync(rootPath)) {
    return results;
  }
  const excludeDirs = options.excludeDirs || new Set<string>();
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (excludeDirs.has(entry.name)) {
        continue;
      }
      results.push(...walkJsonFiles(absolutePath, options));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      results.push(absolutePath);
    }
  }
  return results.sort();
}

export function toDocumentPath(filePath: string): string {
  return path.relative(resolvedProjectRoot, filePath).split(path.sep).join('/');
}
