import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Db } from './index.js';
import { logger } from '../logger.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

/**
 * Applies any .sql files in migrations/ that have not run yet, in filename
 * order. Deliberately not a migration framework: files are append-only and
 * never edited once applied.
 */
export async function migrate(db: Db, directory = MIGRATIONS_DIR): Promise<string[]> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = await db.query('SELECT name FROM schema_migrations');
  const already = new Set(applied.rows.map((row) => row['name'] as string));

  const pending = readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .filter((file) => !already.has(file));

  for (const file of pending) {
    const sql = readFileSync(join(directory, file), 'utf8');
    // PGlite needs exec() for multi-statement SQL; pg handles it via query().
    if (db.exec) await db.exec(sql);
    else await db.query(sql);
    await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    logger.info('migration applied', { migration: file });
  }

  return pending;
}
