import pg, { Pool, PoolClient } from 'pg';
import { env } from '../config/env.js';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: env.DB_POOL_LIMIT,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });
  }
  return pool;
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const currentPool = getPool();
    const res = await currentPool.query('SELECT 1 as healthy');
    return res.rows.length > 0;
  } catch (err) {
    console.error('PostgreSQL health check failed:', err);
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
