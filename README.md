# Realtime Chat App

A real-time messaging app with private and group chats, built on Node.js, Express, Socket.io, PostgreSQL and Redis. It runs as **two server instances at once** and keeps them in sync with Redis pub/sub.

[![CI](https://github.com/rajanSaini12/realtime-chat-app/actions/workflows/ci.yml/badge.svg)](https://github.com/rajanSaini12/realtime-chat-app/actions/workflows/ci.yml)

## Features

- **Accounts:** register and log in. Passwords are hashed with bcrypt and sessions use JWTs.
- **Private chats (1:1):** each pair of users gets one conversation with a deterministic id (`dm:<smaller id>:<larger id>`).
- **Group rooms:** create, list and join named rooms. Only members can read or post.
- **Real time over WebSockets (Socket.io):** new messages, a typing indicator and online/offline presence.
- **Message history in PostgreSQL:** cursor-based pagination backed by a composite index.
- **Horizontal scaling:** `@socket.io/redis-adapter` uses Redis pub/sub, so a user on instance 1 can chat with a user on instance 2.
- **Validation and errors:** every REST body and socket payload is checked with zod, and the API returns consistent JSON errors.
- **One-command setup:** Docker Compose starts Postgres, Redis, a migration job and two app instances.
- **Tested:** REST, Socket.io and two-instance Redis sync tests run in GitHub Actions.

## Screenshots

> **TODO:** add screenshots of the login page, a group room and the mobile layout (for example `docs/screenshots/*.png`).

## Architecture

```mermaid
flowchart LR
    subgraph Clients
        A[Browser A]
        B[Browser B]
    end

    subgraph App["Node.js app instances (Express + Socket.io)"]
        APP1["app1 :3001"]
        APP2["app2 :3002"]
    end

    A <-- "REST + WebSocket" --> APP1
    B <-- "REST + WebSocket" --> APP2

    APP1 <-- "pub/sub (socket.io#* channels)" --> R[(Redis)]
    APP2 <-- "pub/sub (socket.io#* channels)" --> R

    APP1 -- "SQL (pg)" --> PG[(PostgreSQL)]
    APP2 -- "SQL (pg)" --> PG
```

- **PostgreSQL** is the source of truth: users, conversations, memberships and messages.
- **Redis** holds no chat data. It only carries Socket.io messages between instances.
- The instances are **stateless**. Any of them can serve any request, because a JWT is verified with a shared secret and nothing is stored in server memory between requests.

Inside one instance the code is layered:

```
routes/ (HTTP)   sockets/ (WebSocket)
        \            /
         services/          business rules: membership checks, private-chat ids, pagination
             |
     db/repositories/       all SQL lives here
             |
          pg.Pool            (pg-mem in tests)
```

## Tech stack

| Area      | Technology                                                        |
| --------- | ----------------------------------------------------------------- |
| Runtime   | Node.js (LTS), JavaScript ES modules                              |
| HTTP API  | Express 5, helmet, zod                                            |
| Real time | Socket.io 4, `@socket.io/redis-adapter`, node-redis               |
| Database  | PostgreSQL 16 via `pg`, plain SQL migrations                      |
| Auth      | JWT (`jsonwebtoken`, HS256), bcrypt password hashing (`bcryptjs`) |
| Frontend  | Plain HTML, CSS and JavaScript (no build step), served by Express |
| DevOps    | Docker, Docker Compose, GitHub Actions                            |
| Testing   | `node:test`, supertest, socket.io-client, pg-mem                  |
| Quality   | ESLint (flat config) and Prettier                                 |

## Quick start (Docker)

Requires Docker with the Compose plugin.

```bash
git clone https://github.com/rajanSaini12/realtime-chat-app.git
cd realtime-chat-app
docker compose up --build
```

This starts:

| Service    | What it does                                     | URL                     |
| ---------- | ------------------------------------------------ | ----------------------- |
| `postgres` | PostgreSQL 16 (data kept in the `pgdata` volume) | internal                |
| `redis`    | Redis 7, used for pub/sub                        | internal                |
| `migrate`  | Applies SQL migrations once, then exits          | n/a                     |
| `app1`     | App instance 1                                   | <http://localhost:3001> |
| `app2`     | App instance 2                                   | <http://localhost:3002> |

**Try the cross-instance sync:** open <http://localhost:3001> in one browser and <http://localhost:3002> in a private window. Register a different user in each. The sidebar shows which instance you are connected to ("connected to app1"). Send a private message or a group message: it arrives instantly on the other instance.

The compose file has a development-only `JWT_SECRET` default. Set your own with `JWT_SECRET=... docker compose up` for anything beyond local testing.

To stop and delete the data: `docker compose down -v`.

## Local development (without Docker for the app)

Requires Node.js 22 or newer (tested on 22 and 24), PostgreSQL and (optionally) Redis.

```bash
npm install
cp .env.example .env          # then edit DATABASE_URL, REDIS_URL and JWT_SECRET
npm run migrate               # create the tables
npm run dev                   # starts on http://localhost:3000 and restarts on file changes
```

If you only want the databases in Docker: `docker compose up postgres redis` and then publish their ports, or use local installs.

If `REDIS_URL` is empty, the app runs as a single instance with Socket.io's in-memory adapter. To run two instances locally, start a second process with a different port and instance id:

```bash
PORT=3001 INSTANCE_ID=app1 npm start
PORT=3002 INSTANCE_ID=app2 npm start
```

### Environment variables

| Variable         | Required | Default       | Description                                                     |
| ---------------- | -------- | ------------- | --------------------------------------------------------------- |
| `DATABASE_URL`   | yes      | n/a           | PostgreSQL connection string                                    |
| `JWT_SECRET`     | yes      | n/a           | At least 16 characters. **Must be the same on every instance.** |
| `REDIS_URL`      | no       | empty         | Enables the Redis adapter for multi-instance sync               |
| `PORT`           | no       | `3000`        | HTTP port                                                       |
| `INSTANCE_ID`    | no       | `local`       | Name shown in `/api/health` and in the UI                       |
| `JWT_EXPIRES_IN` | no       | `7d`          | Token lifetime                                                  |
| `BCRYPT_ROUNDS`  | no       | `10`          | bcrypt cost factor (4 to 15)                                    |
| `NODE_ENV`       | no       | `development` | `development`, `production` or `test`                           |

The config is validated with zod at startup, so a missing or invalid value stops the app with a clear message.

## REST API

All endpoints except register, login and health need `Authorization: Bearer <token>`. Errors look like `{ "error": "message", "details": [...] }`.

| Method | Path                              | Body / query                             | Description                                                       |
| ------ | --------------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| GET    | `/api/health`                     | n/a                                      | `{ status, instance }`; checks the database connection            |
| POST   | `/api/auth/register`              | `{ username, password }`                 | Creates a user. `201 { user, token }`, `409` if the name is taken |
| POST   | `/api/auth/login`                 | `{ username, password }`                 | `200 { user, token }`, `401` on bad credentials                   |
| GET    | `/api/users/me`                   | n/a                                      | The logged-in user                                                |
| GET    | `/api/users`                      | n/a                                      | All users, each with an `online` flag                             |
| GET    | `/api/rooms`                      | n/a                                      | All group rooms with `memberCount` and `isMember`                 |
| POST   | `/api/rooms`                      | `{ name }`                               | Creates a room; the creator joins it. `409` if the name exists    |
| POST   | `/api/rooms/:id/join`             | n/a                                      | Joins a room (safe to repeat)                                     |
| POST   | `/api/conversations/direct`       | `{ userId }`                             | Finds or creates the private conversation with that user          |
| GET    | `/api/conversations/:id/messages` | `?limit=1..100` (default 30), `?cursor=` | One page of history, newest first, plus `nextCursor`              |

Validation rules: usernames are 3 to 32 letters, digits or underscores (unique regardless of case); passwords are 8 to 72 characters; messages are 1 to 2000 characters.

**Paging example:**

```bash
GET /api/conversations/12/messages?limit=30
# -> { "messages": [ ...30 newest... ], "nextCursor": "eyJ0IjoiMjAyNi0..." }

GET /api/conversations/12/messages?limit=30&cursor=eyJ0IjoiMjAyNi0...
# -> the next 30 older messages; "nextCursor": null when there are no more
```

## Socket.io events

Connect with the JWT in the handshake: `io(url, { auth: { token } })`. Connections without a valid token are rejected before any event handler runs.

Events the client sends take an acknowledgement callback and get back `{ ok: true, ... }` or `{ ok: false, error }`.

| Direction        | Event             | Payload                                                                                  | Notes                                                             |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| client to server | `private:message` | `{ toUserId, body }`                                                                     | Creates the 1:1 conversation on first use. Ack: `{ ok, message }` |
| client to server | `group:message`   | `{ roomId, body }`                                                                       | Sender must be a member. Ack: `{ ok, message }`                   |
| client to server | `typing`          | `{ conversationId, isTyping }`                                                           | Relayed to the other members, not stored                          |
| server to client | `session`         | `{ user, instance }`                                                                     | Sent once after connecting                                        |
| server to client | `message:new`     | `{ id, conversationId, senderId, senderUsername, body, createdAt, type, participants? }` | Sent to every member of the conversation, on every instance       |
| server to client | `typing`          | `{ conversationId, userId, username, isTyping }`                                         |                                                                   |
| server to client | `presence:update` | `{ userId, online }`                                                                     | Sent when a user's first tab connects or last tab disconnects     |
| server to client | `room:created`    | `{ id, name, memberCount }`                                                              | Lets every client add the new room to its list                    |

### Socket.io rooms used

| Room         | Members                           | Used for                                                        |
| ------------ | --------------------------------- | --------------------------------------------------------------- |
| `user:<id>`  | every open socket (tab) of a user | Presence, and subscribing a user's sockets to new conversations |
| `dm:<a>:<b>` | both users of a private chat      | Private messages and typing                                     |
| `room:<id>`  | members of a group room           | Group messages and typing                                       |

On connect, a socket joins `user:<id>` plus the room of every conversation the user belongs to (one indexed query).

## Database schema

Defined in [`src/db/migrations/001_initial_schema.sql`](src/db/migrations/001_initial_schema.sql).

```mermaid
erDiagram
    users ||--o{ conversation_members : "is in"
    conversations ||--o{ conversation_members : has
    conversations ||--o{ messages : contains
    users ||--o{ messages : sends

    users {
        serial id PK
        varchar username "unique, case-insensitive"
        text password_hash
        timestamptz created_at
    }
    conversations {
        serial id PK
        varchar type "direct | group"
        varchar name "groups only"
        varchar direct_key "dm:low:high, unique"
        int created_by FK
        timestamptz created_at
    }
    conversation_members {
        int conversation_id PK, FK
        int user_id PK, FK
        timestamptz joined_at
    }
    messages {
        bigserial id PK
        int conversation_id FK
        int sender_id FK
        text body "1 to 2000 chars"
        timestamptz created_at "millisecond precision"
    }
```

Private chats and group rooms share one `conversations` table, so messages, membership and history work the same way for both.

### Indexes and why they exist

| Index                                                           | Query it serves                                                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `messages (conversation_id, created_at DESC, id DESC)`          | Loading history: "the newest N messages of conversation X older than the cursor"                                 |
| `conversation_members` primary key `(conversation_id, user_id)` | "Is user U a member of conversation X?" (checked before loading history, posting to a group and relaying typing) |
| `conversation_members (user_id)`                                | "Which conversations is user U in?" (run on every socket connection)                                             |
| `users` unique on `lower(username)`                             | Login lookup and case-insensitive uniqueness ("Rajan" and "rajan" can't both exist)                              |
| `conversations.direct_key` unique                               | Finding the private chat for two users, and making sure only one exists per pair                                 |
| `conversations` unique on `lower(name)` where `type = 'group'`  | Unique room names. It is a _partial_ index, so private chats (no name) are not included                          |

**The history index in detail.** The history query is:

```sql
SELECT ... FROM messages m
WHERE m.conversation_id = $1
  AND m.created_at <= $3 AND (m.created_at < $3 OR m.id < $4)   -- only when a cursor is given
ORDER BY m.created_at DESC, m.id DESC
LIMIT $2;
```

The index columns match the `WHERE` and the `ORDER BY` exactly. Postgres can jump to the newest entry of that conversation and read rows in index order until it has `LIMIT` rows. It does not scan other conversations and it does not need a separate sort step. Without the index it would have to find every message of the conversation and sort them on every request.

You can check this yourself after adding some data: `EXPLAIN` on the query above shows an `Index Scan` (or `Index Only Scan`) using `messages_conversation_created_at_idx`. On a nearly empty table Postgres may still pick a sequential scan, because reading a few rows directly is cheaper.

### Why cursor pagination instead of `OFFSET`

- `OFFSET 1000` still reads and throws away 1000 rows, so it gets slower the further back you scroll. A cursor starts directly at the right place in the index.
- With `OFFSET`, a new message arriving while you scroll shifts every row by one, so you see a duplicate or miss a message. A cursor always continues from "older than the last message I saw".

The cursor is the `(created_at, id)` of the last message on the page, base64url-encoded so clients treat it as opaque. `id` breaks ties between messages with the same timestamp (there is a test for that). `created_at` is stored with millisecond precision so it survives the round trip through a JavaScript `Date` exactly.

## How cross-instance sync works

Each instance has its own Socket.io server and only knows about the sockets connected to it. Without help, a message emitted on `app1` would never reach a user connected to `app2`.

The Redis adapter fixes that:

1. Alice (on `app1`) sends `private:message` to Bob.
2. `app1` saves the message to PostgreSQL, then calls `io.to('dm:1:2').emit('message:new', ...)`.
3. The Redis adapter delivers it to `app1`'s local sockets in that room **and publishes it to a Redis channel**.
4. `app2` is subscribed to the same channel. Its adapter receives the packet and emits it to its own local sockets in `dm:1:2`, which includes Bob.

The same mechanism covers more than messages:

- `io.in('user:7').socketsJoin('room:3')`: when a user joins a room over REST on `app2`, their open sockets on `app1` are subscribed too.
- `io.fetchSockets()`: asks all instances which sockets are connected. This drives the `online` flag and `presence:update`.

Two Redis connections are needed because a connection in subscribe mode can't publish (`pubClient` and `subClient` in [`src/server.js`](src/server.js)).

The instances also need the same `JWT_SECRET`, so a token issued by one is accepted by the other. Because Socket.io falls back to HTTP long-polling on some networks, a load balancer in front of several instances would need sticky sessions. Docker Compose here exposes each instance on its own port, so that isn't needed for the demo.

## Testing

```bash
npm test        # node:test: REST, Socket.io and unit tests
npm run lint    # ESLint + Prettier check
```

By default the tests need **no database or Redis server**:

- The database is [pg-mem](https://github.com/oguimbal/pg-mem), an in-memory PostgreSQL emulator. It exposes the same interface as `pg.Pool`, so the tests run the real migrations, repositories and SQL.
- Socket.io uses its in-memory adapter, and real `socket.io-client` connections are made to a server on a random port.

Two optional environment variables run the same tests against real services:

```bash
# Real PostgreSQL (the schema in that database is DROPPED first, so use a throwaway one)
TEST_DATABASE_URL=postgres://chat:chat@localhost:5432/chat_test npm test

# Real Redis: also runs test/redis-sync.test.js, which starts TWO app servers
# and checks that messages, room joins and presence cross between them
TEST_REDIS_URL=redis://localhost:6379 npm test
```

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs lint, then the tests on pg-mem, then the tests again against PostgreSQL and Redis service containers.

What is covered:

| File                      | Covers                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `test/api.test.js`        | Register/login, bcrypt storage, duplicate names, validation errors, JWT protection, rooms, private chats, pagination |
| `test/socket.test.js`     | Handshake auth, private and group delivery (and non-delivery to others), membership checks, typing, presence         |
| `test/redis-sync.test.js` | Two instances sharing Redis: message delivery, room join, presence                                                   |
| `test/unit.test.js`       | Private-chat key, cursor encoding, config validation                                                                 |

## Project structure

```
realtime-chat-app/
├── src/
│   ├── index.js              # entry point: load config, start server, graceful shutdown
│   ├── server.js             # HTTP server + Socket.io + Redis adapter wiring
│   ├── app.js                # Express app: middleware, routes, static client
│   ├── config.js             # environment variables, validated with zod
│   ├── db/
│   │   ├── pool.js           # pg connection pool
│   │   ├── migrate.js        # migration runner (npm run migrate)
│   │   ├── migrations/       # plain SQL files, applied in order
│   │   └── repositories/     # all SQL queries (users, conversations, messages)
│   ├── services/             # business rules shared by REST and sockets
│   ├── routes/               # Express routers (auth, users, rooms, conversations)
│   ├── sockets/              # Socket.io auth + event handlers, cross-instance helpers
│   ├── middleware/           # JWT auth, error handling
│   ├── validation/           # zod schemas
│   └── utils/                # JWT, cursor, private-chat key, HTTP errors
├── public/                   # browser client (index.html, styles.css, app.js)
├── test/                     # node:test suites + helpers
├── .github/workflows/ci.yml  # CI: lint + tests
├── Dockerfile
├── docker-compose.yml        # postgres, redis, migrate, app1, app2
├── .env.example
└── eslint.config.js, .prettierrc.json
```

## Design decisions

- **Express and Socket.io share one HTTP server and one port.** Socket.io handles `/socket.io/*` (including the client script) and passes everything else to Express.
- **Services are shared by REST and sockets.** For example, membership is checked in one place, `chatService.assertMember`, whether the request came from `GET /messages` or a `group:message` event.
- **Messages are saved before they are broadcast.** Clients only see messages that are already stored, so history and live view always agree.
- **Socket events use acknowledgements.** The sender learns whether its message was accepted, and validation errors go back only to that client.
- **Dependencies are passed in, not imported.** `createServer({ config, db })` takes the database as a parameter, which is what lets the tests swap in pg-mem.
- **Plain SQL, no ORM.** The queries and indexes are small enough to read directly, and the SQL is what an interviewer will ask about anyway.
- **Login errors don't reveal whether a username exists.** Wrong password and unknown user return the same message, and an unknown user still runs one bcrypt compare so the timing is similar.

## Future improvements

- **Presence in Redis:** keep online users in a Redis set with heartbeats instead of calling `fetchSockets()` across instances, which would get expensive with many connections.
- **Read receipts and unread counts stored on the server** (a `last_read_message_id` per member) so they survive a page reload.
- **Rate limiting** on login and message sending (for example a Redis-backed limiter).
- **Refresh tokens** and token revocation, and an httpOnly cookie instead of `localStorage`.
- **Leave room, room roles and invite-only rooms.**
- **A load balancer** (for example nginx with sticky sessions) in front of both instances in Docker Compose.
- **Message edits, deletes, attachments and search** (Postgres full-text search).
- **Structured logging and metrics** (pino, Prometheus) and end-to-end browser tests in CI.

## License

[MIT](LICENSE) © 2026 Rajan Kumar Saini
