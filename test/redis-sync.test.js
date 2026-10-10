/**
 * Cross-instance sync through Redis pub/sub.
 *
 * Starts TWO app servers that share one database and one Redis, connects a
 * client to each, and checks that events cross between them. This needs a real
 * Redis, so it only runs when TEST_REDIS_URL is set, e.g.
 *   TEST_REDIS_URL=redis://localhost:6379 npm test
 * (CI provides a Redis service container for it.)
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {
  createTestDb,
  testConfig,
  startTestServer,
  stopTestServers,
  registerUser,
  connectClient,
  waitFor,
  emitAck,
} from './helpers.js';

const redisUrl = process.env.TEST_REDIS_URL;

describe(
  'cross-instance sync via Redis adapter',
  { skip: !redisUrl && 'TEST_REDIS_URL not set' },
  () => {
    let app1;
    let app2;
    let alice;
    let bob;
    const sockets = [];

    before(async () => {
      const db = await createTestDb();
      app1 = await startTestServer({
        db,
        config: testConfig({ REDIS_URL: redisUrl, INSTANCE_ID: 'app1' }),
      });
      app2 = await startTestServer({
        db,
        config: testConfig({ REDIS_URL: redisUrl, INSTANCE_ID: 'app2' }),
      });
      alice = await registerUser(app1.url, 'alice');
      bob = await registerUser(app2.url, 'bob');
    });

    after(async () => {
      sockets.forEach((s) => s.disconnect());
      await stopTestServers(app1, app2);
    });

    test('a private message sent via app1 reaches a client on app2', async () => {
      const a = await connectClient(app1.url, alice.token);
      const b = await connectClient(app2.url, bob.token);
      sockets.push(a, b);

      const bobReceives = waitFor(b, 'message:new');
      await emitAck(a, 'private:message', { toUserId: bob.user.id, body: 'across instances' });
      assert.equal((await bobReceives).body, 'across instances');
    });

    test('joining a room via app2 subscribes a socket connected to app1', async () => {
      const room = await request(app2.url)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${bob.token}`)
        .send({ name: 'cross' })
        .expect(201);
      const roomId = room.body.room.id;

      const [a, b] = sockets;
      // Alice's socket lives on app1; she joins through app2's REST API.
      await request(app2.url)
        .post(`/api/rooms/${roomId}/join`)
        .set('Authorization', `Bearer ${alice.token}`)
        .expect(200);

      const aliceReceives = waitFor(a, 'message:new', (m) => m.conversationId === roomId);
      await emitAck(b, 'group:message', { roomId, body: 'hello from app2' });
      assert.equal((await aliceReceives).body, 'hello from app2');
    });

    test('presence is visible from both instances', async () => {
      for (const app of [app1, app2]) {
        const res = await request(app.url)
          .get('/api/users')
          .set('Authorization', `Bearer ${alice.token}`)
          .expect(200);
        assert.ok(res.body.users.every((u) => u.online));
      }
    });
  },
);
