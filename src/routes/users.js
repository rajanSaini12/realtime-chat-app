import { Router } from 'express';

export function userRoutes({ userService }) {
  const router = Router();

  // GET /api/users/me -> the logged-in user
  router.get('/me', async (req, res) => {
    res.json({ user: await userService.getUser(req.user.id) });
  });

  // GET /api/users -> every user, each with an `online` flag
  router.get('/', async (_req, res) => {
    res.json({ users: await userService.listUsers() });
  });

  return router;
}
