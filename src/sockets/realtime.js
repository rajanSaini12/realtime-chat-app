/**
 * A small bridge between the services and Socket.io.
 *
 * Every method here works across ALL app instances, not just this one,
 * because Socket.io routes these operations through its adapter. With the
 * Redis adapter, `socketsJoin`, `emit` and `fetchSockets` are published over
 * Redis pub/sub and executed by every instance.
 */

/** Each user's sockets (all tabs, any instance) share a personal room. */
export const userRoom = (userId) => `user:${userId}`;

export function createRealtime(io) {
  return {
    /** Make every open socket of these users join `room`, wherever they are connected. */
    async joinConversation(userIds, room) {
      io.in(userIds.map(userRoom)).socketsJoin(room);
    },

    /** Tell every connected client that a new group room exists. */
    roomCreated(room) {
      io.emit('room:created', room);
    },

    /**
     * Ids of users with at least one connected socket on any instance.
     * fetchSockets() asks every instance (via Redis) for its sockets. That is
     * fine at this project's scale; a large deployment would keep presence in a
     * Redis set instead (see README, "Future improvements").
     */
    async onlineUserIds() {
      const sockets = await io.fetchSockets();
      return new Set(sockets.map((s) => s.data.user.id));
    },

    async isOnline(userId) {
      const sockets = await io.in(userRoom(userId)).fetchSockets();
      return sockets.length > 0;
    },
  };
}
