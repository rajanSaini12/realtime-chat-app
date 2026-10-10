import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { roomRoutes } from './routes/rooms.js';
import { conversationRoutes } from './routes/conversations.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/**
 * Builds the Express app. Dependencies are passed in (not imported) so tests
 * can build the same app on top of an in-memory database.
 */
export function createApp({ config, db, services }) {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Allow the Socket.io WebSocket connection back to this server.
          connectSrc: ["'self'", 'ws:', 'wss:'],
          // Don't force https:// on a plain-http localhost setup.
          upgradeInsecureRequests: null,
        },
      },
    }),
  );
  app.use(express.json({ limit: '16kb' }));

  // Health check used by Docker. Also reports which instance answered.
  app.get('/api/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', instance: config.instanceId });
    } catch {
      res.status(503).json({ status: 'unavailable', instance: config.instanceId });
    }
  });

  app.use('/api/auth', authRoutes(services));

  const auth = requireAuth(config.jwt);
  app.use('/api/users', auth, userRoutes(services));
  app.use('/api/rooms', auth, roomRoutes(services));
  app.use('/api/conversations', auth, conversationRoutes(services));
  app.use('/api', notFoundHandler);

  // The browser client (plain HTML/CSS/JS).
  app.use(express.static(PUBLIC_DIR));

  app.use(errorHandler);
  return app;
}
