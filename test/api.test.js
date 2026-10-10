import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestServer, stopTestServers, registerUser } from './helpers.js';

describe('REST API', () => {
  let server;
  let api; // base URL for supertest

  before(async () => {
    server = await startTestServer();
    api = server.url;
  });
  after(() => stopTestServers(server));

  describe('health', () => {
    test('GET /api/health reports ok and the instance id', async () => {
      const res = await request(api).get('/api/health').expect(200);
      assert.deepEqual(res.body, { status: 'ok', instance: 'local' });
    });
  });

  describe('auth', () => {
    test('register returns a user and a JWT, never the password hash', async () => {
      const res = await request(api)
        .post('/api/auth/register')
        .send({ username: 'alice', password: 'password123' })
        .expect(201);
      assert.equal(res.body.user.username, 'alice');
      assert.match(res.body.token, /^[\w-]+\.[\w-]+\.[\w-]+$/);
      assert.equal(res.body.user.password_hash, undefined);
      assert.equal(res.body.user.passwordHash, undefined);
    });

    test('stores a bcrypt hash, not the plain password', async () => {
      const { rows } = await server.db.query(
        "SELECT password_hash FROM users WHERE username = 'alice'",
      );
      assert.match(rows[0].password_hash, /^\$2[aby]\$/);
      assert.notEqual(rows[0].password_hash, 'password123');
    });

    test('rejects a duplicate username, case-insensitively', async () => {
      const res = await request(api)
        .post('/api/auth/register')
        .send({ username: 'ALICE', password: 'password123' })
        .expect(409);
      assert.equal(res.body.error, 'Username is already taken');
    });

    test('validates register input', async () => {
      const res = await request(api)
        .post('/api/auth/register')
        .send({ username: 'a!', password: 'short' })
        .expect(400);
      const fields = res.body.details.map((d) => d.field).sort();
      assert.deepEqual(fields, ['password', 'username', 'username']);
    });

    test('rejects a malformed JSON body with 400', async () => {
      await request(api)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"username":')
        .expect(400, { error: 'Malformed JSON body' });
    });

    test('login succeeds with correct credentials (username is case-insensitive)', async () => {
      const res = await request(api)
        .post('/api/auth/login')
        .send({ username: 'Alice', password: 'password123' })
        .expect(200);
      assert.equal(res.body.user.username, 'alice');
      assert.ok(res.body.token);
    });

    test('login fails with the same message for wrong password and unknown user', async () => {
      const wrongPassword = await request(api)
        .post('/api/auth/login')
        .send({ username: 'alice', password: 'wrong-password' })
        .expect(401);
      const unknownUser = await request(api)
        .post('/api/auth/login')
        .send({ username: 'nobody', password: 'password123' })
        .expect(401);
      assert.equal(wrongPassword.body.error, 'Invalid username or password');
      assert.equal(unknownUser.body.error, wrongPassword.body.error);
    });

    test('protected routes require a valid bearer token', async () => {
      await request(api).get('/api/users').expect(401);
      await request(api).get('/api/users').set('Authorization', 'Bearer not.a.jwt').expect(401);
      await request(api).get('/api/rooms').set('Authorization', 'Basic abc').expect(401);
    });

    test('unknown API routes return JSON 404', async () => {
      const res = await request(api).get('/api/nope').expect(404);
      assert.match(res.body.error, /not found/);
    });
  });

  describe('users, rooms and conversations', () => {
    let alice;
    let bob;
    const auth = (u) => ({ Authorization: `Bearer ${u.token}` });

    before(async () => {
      alice = await registerUser(api, 'alice2');
      bob = await registerUser(api, 'bob2');
    });

    test('GET /api/users/me returns the logged-in user', async () => {
      const res = await request(api).get('/api/users/me').set(auth(alice)).expect(200);
      assert.equal(res.body.user.id, alice.user.id);
    });

    test('GET /api/users lists users with an online flag', async () => {
      const res = await request(api).get('/api/users').set(auth(alice)).expect(200);
      const names = res.body.users.map((u) => u.username);
      assert.ok(names.includes('alice2') && names.includes('bob2'));
      assert.ok(res.body.users.every((u) => u.online === false)); // no sockets connected
    });

    test('create, list and join a group room', async () => {
      const created = await request(api)
        .post('/api/rooms')
        .set(auth(alice))
        .send({ name: 'general' })
        .expect(201);
      const roomId = created.body.room.id;
      assert.equal(created.body.room.isMember, true);

      await request(api).post('/api/rooms').set(auth(bob)).send({ name: 'General' }).expect(409);
      await request(api).post('/api/rooms').set(auth(bob)).send({ name: '' }).expect(400);

      let list = await request(api).get('/api/rooms').set(auth(bob)).expect(200);
      let room = list.body.rooms.find((r) => r.id === roomId);
      assert.deepEqual([room.memberCount, room.isMember], [1, false]);

      await request(api).post(`/api/rooms/${roomId}/join`).set(auth(bob)).expect(200);
      await request(api).post(`/api/rooms/${roomId}/join`).set(auth(bob)).expect(200); // idempotent

      list = await request(api).get('/api/rooms').set(auth(bob)).expect(200);
      room = list.body.rooms.find((r) => r.id === roomId);
      assert.deepEqual([room.memberCount, room.isMember], [2, true]);

      await request(api).post('/api/rooms/9999/join').set(auth(bob)).expect(404);
      await request(api).post('/api/rooms/abc/join').set(auth(bob)).expect(400);
    });

    test('private conversation id is the same from both sides', async () => {
      const fromAlice = await request(api)
        .post('/api/conversations/direct')
        .set(auth(alice))
        .send({ userId: bob.user.id })
        .expect(200);
      const fromBob = await request(api)
        .post('/api/conversations/direct')
        .set(auth(bob))
        .send({ userId: alice.user.id })
        .expect(200);
      assert.equal(fromAlice.body.conversation.id, fromBob.body.conversation.id);
      const [low, high] = [alice.user.id, bob.user.id].sort((a, b) => a - b);
      assert.equal(fromAlice.body.conversation.room, `dm:${low}:${high}`);

      await request(api)
        .post('/api/conversations/direct')
        .set(auth(alice))
        .send({ userId: alice.user.id })
        .expect(400);
      await request(api)
        .post('/api/conversations/direct')
        .set(auth(alice))
        .send({ userId: 9999 })
        .expect(404);
    });

    test('message history is cursor-paginated, newest first, members only', async () => {
      const room = await request(api)
        .post('/api/rooms')
        .set(auth(alice))
        .send({ name: 'paging' })
        .expect(201);
      const roomId = room.body.room.id;

      // Insert 5 messages directly (sending over sockets is tested elsewhere).
      for (let i = 1; i <= 5; i++) {
        await server.db.query(
          'INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)',
          [roomId, alice.user.id, `msg ${i}`],
        );
      }

      const url = `/api/conversations/${roomId}/messages`;
      const page1 = await request(api).get(`${url}?limit=2`).set(auth(alice)).expect(200);
      assert.deepEqual(
        page1.body.messages.map((m) => m.body),
        ['msg 5', 'msg 4'],
      );
      assert.equal(page1.body.messages[0].senderUsername, 'alice2');
      assert.ok(page1.body.nextCursor);

      const page2 = await request(api)
        .get(`${url}?limit=2&cursor=${page1.body.nextCursor}`)
        .set(auth(alice))
        .expect(200);
      assert.deepEqual(
        page2.body.messages.map((m) => m.body),
        ['msg 3', 'msg 2'],
      );

      const page3 = await request(api)
        .get(`${url}?limit=2&cursor=${page2.body.nextCursor}`)
        .set(auth(alice))
        .expect(200);
      assert.deepEqual(
        page3.body.messages.map((m) => m.body),
        ['msg 1'],
      );
      assert.equal(page3.body.nextCursor, null);

      // Validation and authorization
      await request(api).get(`${url}?limit=0`).set(auth(alice)).expect(400);
      await request(api).get(`${url}?limit=101`).set(auth(alice)).expect(400);
      await request(api).get(`${url}?cursor=garbage`).set(auth(alice)).expect(400);
      await request(api).get(url).set(auth(bob)).expect(403); // bob never joined
      await request(api).get('/api/conversations/9999/messages').set(auth(alice)).expect(404);
    });

    test('pagination does not skip messages that share a timestamp', async () => {
      const room = await request(api)
        .post('/api/rooms')
        .set(auth(alice))
        .send({ name: 'same-time' })
        .expect(201);
      const roomId = room.body.room.id;
      const ts = '2026-01-01T00:00:00.000Z';
      for (let i = 1; i <= 3; i++) {
        await server.db.query(
          `INSERT INTO messages (conversation_id, sender_id, body, created_at)
           VALUES ($1, $2, $3, $4)`,
          [roomId, alice.user.id, `tie ${i}`, ts],
        );
      }
      const seen = [];
      let cursor = '';
      do {
        const res = await request(api)
          .get(`/api/conversations/${roomId}/messages?limit=1${cursor && `&cursor=${cursor}`}`)
          .set(auth(alice))
          .expect(200);
        seen.push(...res.body.messages.map((m) => m.body));
        cursor = res.body.nextCursor;
      } while (cursor);
      assert.deepEqual(seen, ['tie 3', 'tie 2', 'tie 1']);
    });
  });
});
