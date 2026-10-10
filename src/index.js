import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { createServer } from './server.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const server = await createServer({ config, db: pool });
const { port } = await server.listen();

console.log(
  `[app] instance "${config.instanceId}" listening on :${port}` +
    (config.redisUrl ? ' (Redis adapter enabled)' : ' (single instance, no Redis)'),
);

// Graceful shutdown: stop accepting connections, then release DB/Redis.
async function shutdown(signal) {
  console.log(`[app] ${signal} received, shutting down`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  try {
    await server.close();
    await pool.end();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
