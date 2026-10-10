import { verifyToken } from '../utils/tokens.js';
import { HttpError, badRequest } from '../utils/errors.js';
import { socketRoomFor } from '../services/chatService.js';
import {
  parse,
  privateMessageSchema,
  groupMessageSchema,
  typingSchema,
} from '../validation/schemas.js';
import { userRoom } from './realtime.js';

/**
 * Registers authentication and all event handlers on the Socket.io server.
 * Returns `{ drain }`, used for a clean shutdown.
 *
 * Client -> server events use acknowledgements: the client passes a callback
 * and gets back `{ ok: true, ... }` or `{ ok: false, error }`.
 */
export function registerSocketHandlers(io, { config, services, realtime }) {
  const { chatService } = services;

  // Presence checks still running after a disconnect. On shutdown we wait for
  // them before closing Redis, otherwise they would fail with "client closed".
  const pending = new Set();
  const track = (promise) => {
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
  };

  // 1) Authenticate during the handshake. The client connects with
  //    io({ auth: { token } }). Rejected sockets never reach 'connection'.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      socket.data.user = verifyToken(token, config.jwt);
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.data.user;

    // Wraps a handler with validation + a consistent ack/error format.
    const on = (event, schema, handler) => {
      socket.on(event, async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          const result = await handler(parse(schema, payload ?? {}));
          reply({ ok: true, ...result });
        } catch (err) {
          if (!(err instanceof HttpError)) console.error(`[socket] ${event} failed:`, err);
          reply({ ok: false, error: err instanceof HttpError ? err.message : 'Internal error' });
        }
      });
    };

    // 2) Register handlers first so no early client event is missed.

    // Private 1:1 message. Both users share the deterministic room 'dm:<low>:<high>'.
    on('private:message', privateMessageSchema, async ({ toUserId, body }) => {
      const conversation = await chatService.getOrCreateDirect({
        userId: user.id,
        otherUserId: toUserId,
      });
      // Make sure this socket is in the room even if it connected before the
      // conversation existed (joinConversation covers the user's other sockets).
      socket.join(conversation.room);
      const message = await chatService.sendMessage({
        conversationId: conversation.id,
        senderId: user.id,
        senderUsername: user.username,
        body,
      });
      const event = { ...message, type: 'direct', participants: [user.id, toUserId] };
      // io.to(room) reaches members on EVERY instance via the Redis adapter.
      io.to(conversation.room).emit('message:new', event);
      return { message: event };
    });

    // Group message. Only members may post.
    on('group:message', groupMessageSchema, async ({ roomId, body }) => {
      const conversation = await chatService.assertMember(roomId, user.id);
      if (conversation.type !== 'group') throw badRequest('Not a group room');
      const message = await chatService.sendMessage({
        conversationId: roomId,
        senderId: user.id,
        senderUsername: user.username,
        body,
      });
      const event = { ...message, type: 'group' };
      io.to(socketRoomFor(conversation)).emit('message:new', event);
      return { message: event };
    });

    // Typing indicator: relayed to everyone else in the conversation, not stored.
    on('typing', typingSchema, async ({ conversationId, isTyping }) => {
      const conversation = await chatService.assertMember(conversationId, user.id);
      socket.to(socketRoomFor(conversation)).emit('typing', {
        conversationId,
        userId: user.id,
        username: user.username,
        isTyping,
      });
      return {};
    });

    socket.on('disconnect', () => {
      // Socket.io has already removed this socket from its rooms here, so if
      // the user's personal room is empty everywhere, they just went offline.
      track(
        realtime
          .isOnline(user.id)
          .then((online) => {
            if (!online) io.emit('presence:update', { userId: user.id, online: false });
          })
          .catch((err) => console.error('[socket] presence update failed:', err.message)),
      );
    });

    // 3) Join rooms and announce presence.
    try {
      // Checked before joining: if no other socket of this user exists on any
      // instance, this connection brings them online.
      const wasOnline = await realtime.isOnline(user.id);
      const conversations = await chatService.listConversationsForUser(user.id);
      socket.join([userRoom(user.id), ...conversations.map(socketRoomFor)]);
      if (!wasOnline) io.emit('presence:update', { userId: user.id, online: true });
      socket.emit('session', { user, instance: config.instanceId });
    } catch (err) {
      console.error('[socket] connection setup failed:', err);
      socket.disconnect(true);
    }
  });

  return {
    /** Resolves once every in-flight disconnect handler has finished. */
    drain: () => Promise.all(pending),
  };
}
