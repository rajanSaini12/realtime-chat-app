-- Users -----------------------------------------------------------------------
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(32) NOT NULL,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Usernames are unique regardless of case ("Rajan" and "rajan" are the same
-- user). Login looks users up with `WHERE lower(username) = lower($1)`, which
-- this expression index serves directly.
CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username));

-- Conversations ---------------------------------------------------------------
-- One table for both kinds of chat:
--   * 'group'  : a named room that users join.
--   * 'direct' : a private 1:1 chat. `direct_key` is deterministic,
--                'dm:<smaller user id>:<larger user id>', so the same two users
--                always map to exactly one conversation (enforced by UNIQUE).
CREATE TABLE conversations (
  id         SERIAL PRIMARY KEY,
  type       VARCHAR(10) NOT NULL CHECK (type IN ('direct', 'group')),
  name       VARCHAR(64),
  direct_key VARCHAR(64) UNIQUE,
  created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (type = 'group' AND name IS NOT NULL) OR
    (type = 'direct' AND direct_key IS NOT NULL)
  )
);

-- Group names are unique (case-insensitive). A partial index only covers
-- group rows, so direct conversations (name IS NULL) are not affected.
CREATE UNIQUE INDEX conversations_group_name_key
  ON conversations (lower(name)) WHERE type = 'group';

CREATE TABLE conversation_members (
  conversation_id INTEGER     NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_id         INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The composite primary key answers "is user X a member of conversation Y?"
  PRIMARY KEY (conversation_id, user_id)
);

-- The PK above starts with conversation_id, so it cannot efficiently answer
-- "which conversations is user X in?" (asked on every socket connection).
CREATE INDEX conversation_members_user_id_idx ON conversation_members (user_id);

-- Messages --------------------------------------------------------------------
CREATE TABLE messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id       INTEGER REFERENCES users (id) ON DELETE SET NULL,
  body            TEXT    NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  -- Millisecond precision on purpose: the pagination cursor round-trips this
  -- value through a JavaScript Date (ms precision). With Postgres' default
  -- microsecond precision, rows could be skipped at page boundaries.
  created_at      TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

-- The hot query: "latest N messages of conversation X, older than cursor C".
--   WHERE conversation_id = $1 AND (created_at, id) < cursor
--   ORDER BY created_at DESC, id DESC LIMIT n
-- With this index Postgres jumps straight to the conversation's newest entry
-- and reads rows already in the right order: no full scan, no sort step.
-- `id` is the tie-breaker for messages that share the same timestamp.
CREATE INDEX messages_conversation_created_at_idx
  ON messages (conversation_id, created_at DESC, id DESC);
