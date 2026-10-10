import { z } from 'zod';
import { badRequest } from '../utils/errors.js';

// Shared validation rules for REST bodies and socket event payloads.

const username = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(32, 'Username must be at most 32 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers and underscores');

export const registerSchema = z.object({
  username,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    // bcrypt only uses the first 72 bytes of a password; reject longer ones.
    .max(72, 'Password must be at most 72 characters'),
});

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export const createRoomSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Room name must be at least 2 characters')
    .max(64, 'Room name must be at most 64 characters'),
});

export const idParamSchema = z.coerce.number().int().positive();

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).optional(),
});

const messageBody = z
  .string()
  .trim()
  .min(1, 'Message cannot be empty')
  .max(2000, 'Message must be at most 2000 characters');

// Socket event payloads
export const privateMessageSchema = z.object({
  toUserId: z.coerce.number().int().positive(),
  body: messageBody,
});

export const groupMessageSchema = z.object({
  roomId: z.coerce.number().int().positive(),
  body: messageBody,
});

export const typingSchema = z.object({
  conversationId: z.coerce.number().int().positive(),
  isTyping: z.boolean(),
});

/** Parses `data` with `schema` or throws a 400 HttpError listing the problems. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const details = result.error.issues.map((i) => ({
    field: i.path.join('.') || undefined,
    message: i.message,
  }));
  throw badRequest(details[0]?.message ?? 'Invalid input', details);
}
