import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import {
  startTestServer,
  stopTestServers,
  registerUser,
  connectClient,
  waitFor,
  expectNoEvent,
  emitAck,
} from './helpers.js';

describe('Socket.io', () => {
  let server;
  let alice;
  let bob;
  let carol;
  const sockets = [];

  // Connect and remember the socket so it is closed after each test.
  const connect = async (user) => {
    const socket = await connectClient(server.url, user.token);
    sockets.push(socket);
    return socket;
  };

  before(async () => {
    server = await startTestServer();
    alice = await registerUser(server.url, 'alice');
    bob = await registerUser(server.url, 'bob');
    carol = await registerUser(server.url, 'carol');
  });
  afterEach(() => sockets.splice(0).forEach((s) => s.disconnect()));
  after(() => stopTestServers(server));

  test('rejects connections without a valid JWT', async () => {
    for (const auth of [{}, { token: 'not-a-jwt' }]) {
      const socket = ioClient(server.url, { auth, transports: ['websocket'], forceNew: true });
      const err = await waitFor(socket, 'connect_error');
      assert.match(err.message, /Authentication required|Invalid or expired token/);
      socket.disconnect();
    }
  });

  test('private message reaches both participants only, and is persisted', async () => {
    const [a, b, c] = await Promise.all([connect(alice), connect(bob), connect(carol)]);

    const bobReceives = waitFor(b, 'message:new');
    const carolReceivesNothing = expectNoEvent(c, 'message:new');
    const ack = await emitAck(a, 'private:message', { toUserId: bob.user.id, body: 'hi bob' });

    assert.equal(ack.ok, true);
    const received = await bobReceives;
    assert.equal(received.body, 'hi bob');
    assert.equal(received.type, 'direct');
    assert.equal(received.senderUsername, 'alice');
    await carolReceivesNothing;

    // History via REST contains the message for both participants.
    const res = await request(server.url)
      .get(`/api/conversations/${received.conversationId}/messages`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    assert.equal(res.body.messages[0].body, 'hi bob');

    // ...and carol cannot read it.
    await request(server.url)
      .get(`/api/conversations/${received.conversationId}/messages`)
      .set('Authorization', `Bearer ${carol.token}`)
      .expect(403);
  });

  test('both directions of a private chat use the same conversation', async () => {
    const [a, b] = await Promise.all([connect(alice), connect(bob)]);
    const first = await emitAck(a, 'private:message', { toUserId: bob.user.id, body: 'ping' });
    const reply = await emitAck(b, 'private:message', { toUserId: alice.user.id, body: 'pong' });
    assert.equal(first.message.conversationId, reply.message.conversationId);
  });

  test('group message reaches room members but not non-members', async () => {
    const room = await request(server.url)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ name: 'team' })
      .expect(201);
    const roomId = room.body.room.id;

    const [a, b, c] = await Promise.all([connect(alice), connect(bob), connect(carol)]);

    // Bob joins over REST while already connected; his open socket must be
    // subscribed to the room without reconnecting.
    await request(server.url)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);

    const bobReceives = waitFor(b, 'message:new', (m) => m.conversationId === roomId);
    const carolReceivesNothing = expectNoEvent(c, 'message:new');
    const ack = await emitAck(a, 'group:message', { roomId, body: 'hello team' });
    assert.equal(ack.ok, true);
    assert.equal((await bobReceives).body, 'hello team');
    await carolReceivesNothing;

    // Non-members cannot post.
    const denied = await emitAck(c, 'group:message', { roomId, body: 'let me in' });
    assert.deepEqual(denied, { ok: false, error: 'You are not a member of this conversation' });
  });

  test('invalid payloads are rejected with an error ack', async () => {
    const a = await connect(alice);
    const empty = await emitAck(a, 'private:message', { toUserId: bob.user.id, body: '   ' });
    assert.deepEqual(empty, { ok: false, error: 'Message cannot be empty' });
    const self = await emitAck(a, 'private:message', { toUserId: alice.user.id, body: 'me' });
    assert.deepEqual(self, { ok: false, error: 'You cannot message yourself' });
    const missing = await emitAck(a, 'group:message', { roomId: 9999, body: 'x' });
    assert.deepEqual(missing, { ok: false, error: 'Conversation not found' });
  });

  test('typing indicator is relayed to the other participant, not echoed back', async () => {
    const [a, b] = await Promise.all([connect(alice), connect(bob)]);
    const { message } = await emitAck(a, 'private:message', {
      toUserId: bob.user.id,
      body: 'typing test',
    });
    const conversationId = message.conversationId;

    const bobSeesTyping = waitFor(b, 'typing');
    const aliceSeesNothing = expectNoEvent(a, 'typing');
    await emitAck(a, 'typing', { conversationId, isTyping: true });
    assert.deepEqual(await bobSeesTyping, {
      conversationId,
      userId: alice.user.id,
      username: 'alice',
      isTyping: true,
    });
    await aliceSeesNothing;
  });

  test('presence: online/offline updates and the users list online flag', async () => {
    const b = await connect(bob);

    const aliceOnline = waitFor(b, 'presence:update', (p) => p.userId === alice.user.id);
    const a = await connect(alice);
    assert.deepEqual(await aliceOnline, { userId: alice.user.id, online: true });

    const res = await request(server.url)
      .get('/api/users')
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    const online = Object.fromEntries(res.body.users.map((u) => [u.username, u.online]));
    assert.deepEqual(online, { alice: true, bob: true, carol: false });

    // A second tab does not re-announce; closing one of two tabs keeps alice online.
    const secondTab = await connect(alice);
    const noFlap = expectNoEvent(b, 'presence:update');
    secondTab.disconnect();
    await noFlap;

    const aliceOffline = waitFor(b, 'presence:update', (p) => p.userId === alice.user.id);
    a.disconnect();
    assert.deepEqual(await aliceOffline, { userId: alice.user.id, online: false });
  });
});
