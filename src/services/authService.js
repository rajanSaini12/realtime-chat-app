import bcrypt from 'bcryptjs';
import { signToken } from '../utils/tokens.js';
import { conflict, unauthorized, PG_UNIQUE_VIOLATION } from '../utils/errors.js';

const toPublicUser = (u) => ({ id: u.id, username: u.username, createdAt: u.created_at });

export function createAuthService({ repos, config }) {
  // A fixed hash used when the username doesn't exist, so a failed login takes
  // about the same time either way and doesn't reveal which usernames exist.
  const dummyHash = bcrypt.hashSync('dummy-password-for-timing', config.bcryptRounds);

  return {
    async register({ username, password }) {
      if (await repos.users.findByUsername(username)) throw conflict('Username is already taken');
      const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
      let user;
      try {
        user = await repos.users.create({ username, passwordHash });
      } catch (err) {
        // Two simultaneous registrations can both pass the check above;
        // the unique index is the real guarantee.
        if (err.code === PG_UNIQUE_VIOLATION) throw conflict('Username is already taken');
        throw err;
      }
      return { user: toPublicUser(user), token: signToken(user, config.jwt) };
    },

    async login({ username, password }) {
      const user = await repos.users.findByUsername(username);
      const ok = await bcrypt.compare(password, user?.password_hash ?? dummyHash);
      // Same message for "no such user" and "wrong password" on purpose.
      if (!user || !ok) throw unauthorized('Invalid username or password');
      return { user: toPublicUser(user), token: signToken(user, config.jwt) };
    },
  };
}
