import pg from 'pg';

/**
 * Creates a PostgreSQL connection pool.
 *
 * The rest of the app only depends on the small `{ query, connect }` interface
 * that `pg.Pool` exposes. That is what lets the tests swap in pg-mem (an
 * in-memory Postgres emulator) without touching any application code.
 */
export function createPool(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // An idle client can error (e.g. the DB restarts). Log it instead of crashing.
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  return pool;
}
