import { Router } from 'express';
import { z } from 'zod';
import { parse, idParamSchema, historyQuerySchema } from '../validation/schemas.js';

const directSchema = z.object({ userId: z.coerce.number().int().positive() });

export function conversationRoutes({ chatService }) {
  const router = Router();

  // POST /api/conversations/direct { userId } -> { conversation }
  // Finds or creates the private 1:1 conversation with another user.
  router.post('/direct', async (req, res) => {
    const { userId } = parse(directSchema, req.body);
    const conversation = await chatService.getOrCreateDirect({
      userId: req.user.id,
      otherUserId: userId,
    });
    res.json({ conversation });
  });

  // GET /api/conversations/:id/messages?limit=30&cursor=<nextCursor>
  // -> { messages (newest first), nextCursor (null when no older messages) }
  router.get('/:id/messages', async (req, res) => {
    const conversationId = parse(idParamSchema, req.params.id);
    const { limit, cursor } = parse(historyQuerySchema, req.query);
    res.json(await chatService.getHistory({ conversationId, userId: req.user.id, limit, cursor }));
  });

  return router;
}
