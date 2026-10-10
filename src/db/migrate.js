import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * A minimal forward-only migration runner.
 *
 * Files in ./migrations are applied in filename order (001_, 002_, ...).
 * Each applied filename is recorded in `schema_migrations`, so running this
 * again only applies new files. Each file runs inside its own transaction.
 */
export async function runMigrations(db, { log = () => {} } = {}) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await db.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  const newlyApplied = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      newlyApplied.push(file);
      log(`applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
    } finally {
      client.release();
    }
  }
  return newlyApplied;
}

// Allow `node src/db/migrate.js` (used by `npm run migrate` and docker compose).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { loadConfig } = await import('../config.js');
  const { createPool } = await import('./pool.js');
  const pool = createPool(loadConfig().databaseUrl);
  try {
    const done = await runMigrations(pool, { log: (m) => console.log(`[migrate] ${m}`) });
    console.log(`[migrate] ${done.length ? `${done.length} migration(s) applied` : 'up to date'}`);
  } catch (err) {
    console.error(`[migrate] ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
