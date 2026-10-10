import { Router } from 'express';
import { parse, createRoomSchema, idParamSchema } from '../validation/schemas.js';

export function roomRoutes({ chatService }) {
  const router = Router();

  // GET /api/rooms -> all group rooms (with memberCount / isMember)
  router.get('/', async (req, res) => {
    res.json({ rooms: await chatService.listRooms(req.user.id) });
  });

  // POST /api/rooms { name } -> 201 { room }   (creator becomes a member)
  router.post('/', async (req, res) => {
    const { name } = parse(createRoomSchema, req.body);
    res.status(201).json({ room: await chatService.createRoom({ name, userId: req.user.id }) });
  });

  // POST /api/rooms/:id/join -> { room }   (idempotent)
  router.post('/:id/join', async (req, res) => {
    const roomId = parse(idParamSchema, req.params.id);
    res.json({ room: await chatService.joinRoom({ roomId, userId: req.user.id }) });
  });

  return router;
}
