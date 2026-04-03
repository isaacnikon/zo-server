import { execFileSync } from 'node:child_process';

import {
  DATABASE_HOST,
  DATABASE_NAME,
  DATABASE_PASSWORD,
  DATABASE_PORT,
  DATABASE_USER,
} from '../config.js';

function buildPsqlArgs(sql: string): string[] {
  return [
    '-X',
    '-q',
    '-t',
    '-A',
    '-v',
    'ON_ERROR_STOP=1',
    '-h',
    DATABASE_HOST,
    '-p',
    String(DATABASE_PORT),
    '-d',
    DATABASE_NAME,
    '-U',
    DATABASE_USER,
    '-c',
    sql,
  ];
}

function runPsql(sql: string): string {
  try {
    return execFileSync('psql', buildPsqlArgs(sql), {
      encoding: 'utf8',
      env: {
        ...process.env,
        PGPASSWORD: DATABASE_PASSWORD,
      },
    });
  } catch (error: any) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    const message = stderr || error?.message || 'psql command failed';
    throw new Error(message);
  }
}

export function executePostgresSql(sql: string): void {
  runPsql(sql);
}

export function queryOptionalScalar(sql: string): string | null {
  const output = runPsql(sql).trim();
  return output.length > 0 ? output : null;
}

export function queryOptionalJson<T>(sql: string): T | null {
  const output = queryOptionalScalar(sql);
  if (!output) {
    return null;
  }
  return JSON.parse(output) as T;
}

export function queryJsonArray<T>(sql: string): T[] {
  const output = queryOptionalJson<T[]>(sql);
  return Array.isArray(output) ? output : [];
}
