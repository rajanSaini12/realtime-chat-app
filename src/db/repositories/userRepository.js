/**
 * All SQL for the `users` table lives here. Services never write SQL directly,
 * which keeps queries in one place and easy to review.
 */
export function createUserRepository(db) {
  return {
    async create({ username, passwordHash }) {
      const { rows } = await db.query(
        `INSERT INTO users (username, password_hash)
         VALUES ($1, $2)
         RETURNING id, username, created_at`,
        [username, passwordHash],
      );
      return rows[0];
    },

    // Case-insensitive lookup, served by the unique index on lower(username).
    async findByUsername(username) {
      const { rows } = await db.query(
        `SELECT id, username, password_hash, created_at
         FROM users
         WHERE lower(username) = lower($1)`,
        [username],
      );
      return rows[0] ?? null;
    },

    async findById(id) {
      const { rows } = await db.query('SELECT id, username, created_at FROM users WHERE id = $1', [
        id,
      ]);
      return rows[0] ?? null;
    },

    async list() {
      const { rows } = await db.query(
        'SELECT id, username, created_at FROM users ORDER BY lower(username)',
      );
      return rows;
    },
  };
}
