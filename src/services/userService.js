import { notFound } from '../utils/errors.js';

const toPublicUser = (u) => ({ id: u.id, username: u.username, createdAt: u.created_at });

/**
 * `presence` is optional: it answers "is this user online?" across all
 * instances (see sockets/presence.js). Without it everyone is reported offline.
 */
export function createUserService({ repos, presence }) {
  return {
    async listUsers() {
      const users = await repos.users.list();
      const online = presence ? await presence.onlineUserIds() : new Set();
      return users.map((u) => ({ ...toPublicUser(u), online: online.has(u.id) }));
    },

    async getUser(id) {
      const user = await repos.users.findById(id);
      if (!user) throw notFound('User not found');
      return toPublicUser(user);
    },
  };
}
