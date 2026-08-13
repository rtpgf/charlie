import pg from 'pg';

import { config } from '../config.js';

/**
 * The narrow surface we need from a Postgres connection.
 *
 * Satisfied by both `pg.Pool` (the running service, pointed at Supabase or any
 * Postgres) and PGlite (the test suite, which runs real Postgres in-process).
 * Keeping it this small is what lets tests exercise the actual SQL without a
 * database server or a cloud account.
 */
export interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  /** Multi-statement execution. Present on PGlite; pg handles it via query(). */
  exec?(sql: string): Promise<unknown>;
}

let pool: pg.Pool | undefined;

/**
 * Lazily created so that code paths which never touch the database -- the
 * health check, and Alexa's LaunchRequest -- work without DATABASE_URL set.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    if (!config.database.url) {
      throw new Error('DATABASE_URL is not set. See README "Database setup".');
    }
    // SSL is driven entirely by the connection string (sslmode=require or
    // sslmode=no-verify), so there is no certificate policy hidden in code.
    pool = new pg.Pool({ connectionString: config.database.url });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
