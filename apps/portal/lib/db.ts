import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

const connectionConfig = {
  host: process.env.DATABASE_HOST || '127.0.0.1',
  port: Number(process.env.DATABASE_PORT || 5432),
  database: process.env.DATABASE_NAME || 'zo_server',
  user: process.env.DATABASE_USER || 'zo',
  password: process.env.DATABASE_PASSWORD || 'zo_password',
  max: 10,
  idleTimeoutMillis: 30000,
};

function createPool() {
  return new Pool(connectionConfig);
}

type GlobalWithPortalPool = typeof globalThis & {
  __zoPortalPool?: Pool;
};

const globalForPool = globalThis as GlobalWithPortalPool;

export const pool = globalForPool.__zoPortalPool || createPool();

if (process.env.NODE_ENV !== 'production') {
  globalForPool.__zoPortalPool = pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = []
): Promise<QueryResult<T>> {
  return pool.query(text, values);
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = []
): Promise<T | null> {
  const result = await pool.query(text, values);
  return result.rows[0] || null;
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

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
