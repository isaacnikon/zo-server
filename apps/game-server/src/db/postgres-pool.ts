import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import {
  DATABASE_HOST,
  DATABASE_NAME,
  DATABASE_PASSWORD,
  DATABASE_PORT,
  DATABASE_USER,
} from '../config.js';

const globalForPool = globalThis as typeof globalThis & {
  __zoRuntimePgPool?: Pool;
};

function createPool(): Pool {
  return new Pool({
    host: DATABASE_HOST,
    port: DATABASE_PORT,
    database: DATABASE_NAME,
    user: DATABASE_USER,
    password: DATABASE_PASSWORD,
    max: 6,
    idleTimeoutMillis: 30000,
  });
}

export const postgresPool = globalForPool.__zoRuntimePgPool || createPool();

if (process.env.NODE_ENV !== 'production') {
  globalForPool.__zoRuntimePgPool = postgresPool;
}

export async function queryPostgres<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  return postgresPool.query<T>(text, values);
}

export async function queryOnePostgres<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<T | null> {
  const result = await queryPostgres<T>(text, values);
  return result.rows[0] || null;
}

export async function withPostgresTransaction<T>(
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await postgresPool.connect();

  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
