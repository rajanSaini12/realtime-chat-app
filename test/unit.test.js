import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directKey } from '../src/utils/directKey.js';
import { encodeCursor, decodeCursor } from '../src/utils/cursor.js';
import { loadConfig } from '../src/config.js';

test('directKey is the same regardless of argument order', () => {
  assert.equal(directKey(7, 3), 'dm:3:7');
  assert.equal(directKey(3, 7), 'dm:3:7');
  // Numeric (not string) ordering: 10 > 9
  assert.equal(directKey(10, 9), 'dm:9:10');
});

test('cursor round-trips and rejects garbage', () => {
  const createdAt = '2026-01-02T03:04:05.678Z';
  const cursor = encodeCursor({ createdAt, id: 42 });
  assert.deepEqual(decodeCursor(cursor), { createdAt, id: 42 });

  for (const bad of ['not-base64-json', Buffer.from('{"t":"x","id":1}').toString('base64url')]) {
    assert.throws(() => decodeCursor(bad), { status: 400, message: 'Invalid cursor' });
  }
});

test('loadConfig fails fast on missing or weak settings', () => {
  assert.throws(() => loadConfig({}), /DATABASE_URL/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'x', JWT_SECRET: 'short' }), /JWT_SECRET/);
  const config = loadConfig({ DATABASE_URL: 'x', JWT_SECRET: 'a'.repeat(32), PORT: '4000' });
  assert.equal(config.port, 4000);
  assert.equal(config.redisUrl, '');
});
