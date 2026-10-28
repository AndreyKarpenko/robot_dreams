import { z } from 'zod';
import { loadSigningKeys } from '../auth/keys';

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DB_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  BROKER_URL: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z
      .string()
      .regex(/^amqps?:\/\/.+/, 'must be an amqp URL')
      .optional(),
  ),
  REDIS_URL: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z
      .string()
      .regex(/^rediss?:\/\/.+/, 'must be a redis URL')
      .optional(),
  ),
  REDIS_QUEUE_URL: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z
      .string()
      .regex(/^rediss?:\/\/.+/, 'must be a redis URL')
      .optional(),
  ),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  // No defaults: a fallback here would be a signing key baked into the code.
  JWT_KID: z.string().trim().min(1),
  JWT_PRIVATE_KEY: z.string().trim().min(1),
  JWT_PUBLIC_KEY: z.string().trim().min(1),
  REFRESH_TOKEN_PEPPER: z.string().trim().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function validate(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${lines}\nCompare your .env with .env.example.`,
    );
  }
  loadSigningKeys(parsed.data);
  return parsed.data;
}
