import { newDb, DataType } from 'pg-mem';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { loadConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { createServer } from '../src/server.js';
import { createPool } from '../src/db/pool.js';

/**
 * A fresh database with the real migrations applied.
 *
 * By default this is pg-mem, an in-memory PostgreSQL emulator that exposes the
 * same Pool interface as `pg`, so the application code under test is exactly
 * the code that runs in production and no database server is needed.
 *
 * If TEST_DATABASE_URL is set (CI does this), the same tests run against a
 * real PostgreSQL instead. The schema is wiped first, so point it at a
 * throwaway database.
 */
export async function createTestDb() {
  if (process.env.TEST_DATABASE_URL) {
    const pool = createPool(process.env.TEST_DATABASE_URL);
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(pool);
    return pool;
  }

  const mem = newDb();
  // pg-mem doesn't ship char_length(), which the messages CHECK constraint uses.
  mem.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s) => s.length,
  });
  const { Pool } = mem.adapters.createPg();
  const db = new Pool();
  await runMigrations(db);
  return db;
}

export function testConfig(overrides = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'pg-mem',
    JWT_SECRET: 'test-secret-at-least-16-chars',
    BCRYPT_ROUNDS: '4', // fast hashing for tests
    REDIS_URL: '',
    ...overrides,
  });
}

/** Starts the full app (Express + Socket.io) on a random free port. */
export async function startTestServer({ db, config } = {}) {
  db ??= await createTestDb();
  config ??= testConfig();
  const server = await createServer({ config, db });
  const { port } = await server.listen(0);
  return { ...server, db, config, url: `http://localhost:${port}` };
}

/** Closes servers one at a time (like a rolling shutdown), then the database they share. */
export async function stopTestServers(...servers) {
  for (const server of servers) await server.close();
  await servers[0].db.end();
}

let counter = 0;
/** Registers a user and returns `{ user, token }`. */
export async function registerUser(app, username = `user_${++counter}`) {
  const res = await request(app).post('/api/auth/register').send({
    username,
    password: 'password123',
  });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Connects an authenticated Socket.io client and waits for the server's `session` event. */
export function connectClient(url, token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    socket.once('session', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

/** Resolves with the next `event` payload (optionally matching `predicate`), or rejects on timeout. */
export function waitFor(socket, event, predicate = () => true, ms = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, ms);
    function handler(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

/** Asserts that `event` is NOT received within `ms`. */
export function expectNoEvent(socket, event, ms = 300) {
  return new Promise((resolve, reject) => {
    const handler = (payload) => {
      clearTimeout(timer);
      reject(new Error(`Unexpected "${event}": ${JSON.stringify(payload)}`));
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, ms);
    socket.on(event, handler);
  });
}

/** Emits with an acknowledgement and resolves with the server's reply. */
export function emitAck(socket, event, payload) {
  return socket.timeout(2000).emitWithAck(event, payload);
}
