export function createConversationRepository(db) {
  return {
    async createGroup({ name, createdBy }) {
      const { rows } = await db.query(
        `INSERT INTO conversations (type, name, created_by)
         VALUES ('group', $1, $2)
         RETURNING id, type, name, created_by, created_at`,
        [name, createdBy],
      );
      return rows[0];
    },

    async findById(id) {
      const { rows } = await db.query(
        `SELECT id, type, name, direct_key, created_by, created_at
         FROM conversations WHERE id = $1`,
        [id],
      );
      return rows[0] ?? null;
    },

    /**
     * Lists every group room, with its member count and whether `userId` is a
     * member. The second LEFT JOIN ("me") only matches the current user's row.
     */
    async listGroups(userId) {
      const { rows } = await db.query(
        `SELECT c.id, c.name, c.created_at,
                COUNT(m.user_id)::int     AS member_count,
                (me.user_id IS NOT NULL)  AS is_member
         FROM conversations c
         LEFT JOIN conversation_members m  ON m.conversation_id = c.id
         LEFT JOIN conversation_members me ON me.conversation_id = c.id AND me.user_id = $1
         WHERE c.type = 'group'
         GROUP BY c.id, c.name, c.created_at, me.user_id
         ORDER BY c.name`,
        [userId],
      );
      return rows;
    },

    async findByDirectKey(directKey) {
      const { rows } = await db.query(
        `SELECT id, type, name, direct_key, created_at
         FROM conversations WHERE direct_key = $1`,
        [directKey],
      );
      return rows[0] ?? null;
    },

    /**
     * Returns the direct conversation for `directKey`, creating it if needed.
     * The UNIQUE constraint on direct_key makes this safe under concurrency:
     * if two requests race, both end up with the same row.
     * (DO UPDATE is a no-op update so that RETURNING also yields existing rows.)
     */
    async upsertDirect(directKey) {
      const { rows } = await db.query(
        `INSERT INTO conversations (type, direct_key)
         VALUES ('direct', $1)
         ON CONFLICT (direct_key) DO UPDATE SET direct_key = EXCLUDED.direct_key
         RETURNING id, type, name, direct_key, created_at`,
        [directKey],
      );
      return rows[0];
    },

    // Idempotent: joining twice is not an error.
    async addMember(conversationId, userId) {
      await db.query(
        `INSERT INTO conversation_members (conversation_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [conversationId, userId],
      );
    },

    // Served by the (conversation_id, user_id) primary key.
    async isMember(conversationId, userId) {
      const { rows } = await db.query(
        `SELECT 1 FROM conversation_members
         WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, userId],
      );
      return rows.length > 0;
    },

    // Served by the index on conversation_members(user_id).
    async listForUser(userId) {
      const { rows } = await db.query(
        `SELECT c.id, c.type, c.name, c.direct_key
         FROM conversation_members cm
         JOIN conversations c ON c.id = cm.conversation_id
         WHERE cm.user_id = $1`,
        [userId],
      );
      return rows;
    },
  };
}
