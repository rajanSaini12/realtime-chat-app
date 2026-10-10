import { Router } from 'express';
import { parse, registerSchema, loginSchema } from '../validation/schemas.js';

export function authRoutes({ authService }) {
  const router = Router();

  // POST /api/auth/register  { username, password } -> 201 { user, token }
  router.post('/register', async (req, res) => {
    const input = parse(registerSchema, req.body);
    res.status(201).json(await authService.register(input));
  });

  // POST /api/auth/login  { username, password } -> 200 { user, token }
  router.post('/login', async (req, res) => {
    const input = parse(loginSchema, req.body);
    res.json(await authService.login(input));
  });

  return router;
}
