import 'dotenv/config';
import { z } from 'zod';

// Validate environment variables once at startup so a missing or malformed
// setting fails fast with a clear message instead of breaking at runtime.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  INSTANCE_ID: z.string().default('local'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Optional: without Redis the app runs as a single instance (in-memory adapter).
  REDIS_URL: z.string().optional().default(''),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
});

export function loadConfig(env = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    instanceId: e.INSTANCE_ID,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    jwt: { secret: e.JWT_SECRET, expiresIn: e.JWT_EXPIRES_IN },
    bcryptRounds: e.BCRYPT_ROUNDS,
  };
}
