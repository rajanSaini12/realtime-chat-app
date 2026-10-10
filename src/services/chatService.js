import { directKey } from '../utils/directKey.js';
import { encodeCursor, decodeCursor } from '../utils/cursor.js';
import { badRequest, conflict, forbidden, notFound, PG_UNIQUE_VIOLATION } from '../utils/errors.js';

const toRoom = (r) => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  memberCount: r.member_count,
  isMember: r.is_member,
});

export const toMessage = (m) => ({
  id: Number(m.id), // BIGSERIAL comes back from `pg` as a string
  conversationId: m.conversation_id,
  senderId: m.sender_id,
  senderUsername: m.sender_username,
  body: m.body,
  createdAt: new Date(m.created_at).toISOString(),
});

/**
 * Name of the Socket.io room for a conversation.
 *   - private chat: its deterministic key, e.g. 'dm:3:7'
 *   - group room:   'room:<id>'
 */
export const socketRoomFor = (conversation) =>
  conversation.type === 'direct' ? conversation.direct_key : `room:${conversation.id}`;

// Used when no realtime layer is attached (e.g. REST-only tests).
const noopRealtime = { joinConversation: async () => {}, roomCreated: () => {} };

/**
 * Business rules for rooms, private chats and messages. Used by both the REST
 * routes and the socket handlers so the rules live in exactly one place.
 */
export function createChatService({ repos, realtime = noopRealtime }) {
  async function assertMember(conversationId, userId) {
    const conversation = await repos.conversations.findById(conversationId);
    if (!conversation) throw notFound('Conversation not found');
    if (!(await repos.conversations.isMember(conversationId, userId))) {
      throw forbidden('You are not a member of this conversation');
    }
    return conversation;
  }

  return {
    assertMember,

    /** Conversations (direct + group) the user belongs to, for joining socket rooms. */
    listConversationsForUser(userId) {
      return repos.conversations.listForUser(userId);
    },

    listRooms(userId) {
      return repos.conversations.listGroups(userId).then((rows) => rows.map(toRoom));
    },

    async createRoom({ name, userId }) {
      let room;
      try {
        room = await repos.conversations.createGroup({ name, createdBy: userId });
      } catch (err) {
        if (err.code === PG_UNIQUE_VIOLATION)
          throw conflict('A room with that name already exists');
        throw err;
      }
      await repos.conversations.addMember(room.id, userId); // creator joins automatically
      await realtime.joinConversation([userId], socketRoomFor(room));
      const result = {
        id: room.id,
        name: room.name,
        createdAt: room.created_at,
        memberCount: 1,
        isMember: true,
      };
      // Broadcast to everyone; `isMember` is per-user, so it is not included.
      realtime.roomCreated({ id: result.id, name: result.name, memberCount: 1 });
      return result;
    },

    async joinRoom({ roomId, userId }) {
      const room = await repos.conversations.findById(roomId);
      if (!room || room.type !== 'group') throw notFound('Room not found');
      await repos.conversations.addMember(roomId, userId);
      // Subscribe the user's already-open sockets (on any instance) to the room.
      await realtime.joinConversation([userId], socketRoomFor(room));
      return { id: room.id, name: room.name };
    },

    /**
     * Finds or creates the private conversation between two users.
     * The common case (conversation already exists) is a single indexed lookup
     * on direct_key; the setup work only runs the first time two users talk.
     */
    async getOrCreateDirect({ userId, otherUserId }) {
      if (userId === otherUserId) throw badRequest('You cannot message yourself');
      const key = directKey(userId, otherUserId);
      let conversation = await repos.conversations.findByDirectKey(key);
      if (!conversation) {
        if (!(await repos.users.findById(otherUserId))) throw notFound('User not found');
        conversation = await repos.conversations.upsertDirect(key);
        // Both calls are idempotent, so a race between two first messages is harmless.
        await repos.conversations.addMember(conversation.id, userId);
        await repos.conversations.addMember(conversation.id, otherUserId);
        // Subscribe both users' open sockets (on any instance) to the new room.
        await realtime.joinConversation([userId, otherUserId], socketRoomFor(conversation));
      }
      return {
        id: conversation.id,
        type: 'direct',
        room: socketRoomFor(conversation),
      };
    },

    async sendMessage({ conversationId, senderId, senderUsername, body }) {
      const row = await repos.messages.create({ conversationId, senderId, body });
      return toMessage({ ...row, sender_username: senderUsername });
    },

    /**
     * Returns one page of history (newest first) plus `nextCursor` for the
     * next, older page. `nextCursor` is null when there is nothing older.
     */
    async getHistory({ conversationId, userId, limit, cursor }) {
      await assertMember(conversationId, userId);
      const before = cursor ? decodeCursor(cursor) : null;
      // Fetch one extra row to know whether another page exists.
      const rows = await repos.messages.listPage({ conversationId, before, limit: limit + 1 });
      const hasMore = rows.length > limit;
      const messages = rows.slice(0, limit).map(toMessage);
      const last = messages[messages.length - 1];
      return { messages, nextCursor: hasMore ? encodeCursor(last) : null };
    },
  };
}
