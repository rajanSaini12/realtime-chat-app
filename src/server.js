import http from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { createApp } from './app.js';
import { createRepositories } from './db/repositories/index.js';
import { createServices } from './services/index.js';
import { createRealtime } from './sockets/realtime.js';
import { registerSocketHandlers } from './sockets/index.js';

/**
 * Connects Socket.io to Redis so several app instances behave like one.
 *
 * The adapter needs two connections because a Redis connection in subscribe
 * mode cannot run other commands:
 *   - pubClient publishes "emit X to room Y" for the other instances
 *   - subClient listens for what the other instances publish
 */
async function createRedisAdapter(redisUrl) {
  const pubClient = createClient({ url: redisUrl });
  const subClient = pubClient.duplicate();
  for (const client of [pubClient, subClient]) {
    client.on('error', (err) => console.error('[redis] error:', err.message));
  }
  await Promise.all([pubClient.connect(), subClient.connect()]);
  return {
    adapter: createAdapter(pubClient, subClient),
    // Stop listening first, so no new requests from other instances arrive
    // that would need a reply over the publisher connection.
    close: async () => {
      await subClient.quit();
      await pubClient.quit();
    },
  };
}

/**
 * Builds the HTTP server, Express app and Socket.io server.
 *
 * `db` is anything with pg.Pool's `query`/`connect` (a real pool, or pg-mem in
 * tests). Without `redisUrl`, Socket.io uses its default in-memory adapter,
 * which is correct for a single instance (and for tests).
 */
export async function createServer({ config, db }) {
  const redis = config.redisUrl ? await createRedisAdapter(config.redisUrl) : null;
  const io = new Server(redis ? { adapter: redis.adapter } : {});

  const realtime = createRealtime(io);
  const repos = createRepositories(db);
  const services = createServices({ repos, config, realtime });

  // Order matters: the HTTP server is created with Express as its request
  // handler, and Socket.io is attached afterwards. Socket.io then serves its
  // own paths (/socket.io/...) and passes every other request to Express.
  const httpServer = http.createServer(createApp({ config, db, services }));
  io.attach(httpServer);
  const sockets = registerSocketHandlers(io, { config, services, realtime });

  return {
    httpServer,
    io,
    listen(port = config.port) {
      return new Promise((resolve) => httpServer.listen(port, () => resolve(httpServer.address())));
    },
    async close() {
      // io.close() disconnects every socket and closes the HTTP server.
      await new Promise((resolve) => io.close(() => resolve()));
      // Let the resulting disconnect handlers finish before closing Redis.
      await sockets.drain();
      if (redis) await redis.close();
    },
  };
}
