export function createMessageRepository(db) {
  return {
    async create({ conversationId, senderId, body }) {
      const { rows } = await db.query(
        `INSERT INTO messages (conversation_id, sender_id, body)
         VALUES ($1, $2, $3)
         RETURNING id, conversation_id, sender_id, body, created_at`,
        [conversationId, senderId, body],
      );
      return rows[0];
    },

    /**
     * Keyset ("cursor") pagination, newest first.
     *
     * Instead of OFFSET (which gets slower the deeper you page and can skip or
     * repeat rows while new messages arrive), we remember the last row we
     * returned (created_at, id) and ask for rows strictly older than it.
     *
     * The condition below is equivalent to the row comparison
     * `(created_at, id) < ($2, $3)`, written out longhand. Both forms can use the
     * (conversation_id, created_at DESC, id DESC) index.
     */
    async listPage({ conversationId, before, limit }) {
      const params = [conversationId, limit];
      let cursorSql = '';
      if (before) {
        params.push(before.createdAt, before.id);
        cursorSql = 'AND m.created_at <= $3 AND (m.created_at < $3 OR m.id < $4)';
      }
      const { rows } = await db.query(
        `SELECT m.id, m.conversation_id, m.sender_id, m.body, m.created_at,
                u.username AS sender_username
         FROM messages m
         LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = $1 ${cursorSql}
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT $2`,
        params,
      );
      return rows;
    },
  };
}
