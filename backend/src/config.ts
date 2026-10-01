import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  // Either DATABASE_URL (local) or discrete DB_* parts (AWS: password injected from Secrets Manager).
  DATABASE_URL: z.string().url().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default("app"),
  DB_USER: z.string().default("app"),
  DB_PASSWORD: z.string().optional(),
  DB_SSL: z.enum(["true", "false"]).default("false"),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // AI
  LLM_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  PROMPT_VERSION: z.string().default('v1'),
  LLM_TIMEOUT_MS: z.coerce.number().default(30_000),
  MAX_INPUT_CHARS: z.coerce.number().default(8_000),
  MAX_OUTPUT_TOKENS: z.coerce.number().default(700),
  MOCK_DELAY_MS: z.coerce.number().default(15),

  // Cost / abuse controls
  USER_RATE_LIMIT_PER_MIN: z.coerce.number().default(20),
  DAILY_TOKEN_BUDGET: z.coerce.number().default(200_000),
});

// Config comes only from the environment (12-factor); secrets are injected
// by the runtime (Secrets Manager in AWS), never committed.
const parsed = schema
  .refine((c) => !!c.DATABASE_URL || !!c.DB_HOST, { message: "Set DATABASE_URL or DB_HOST" })
  .refine((c) => c.LLM_PROVIDER !== 'anthropic' || !!c.ANTHROPIC_API_KEY, {
    message: 'ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic',
  })
  .parse(process.env);

export const config = {
  ...parsed,
  databaseUrl:
    parsed.DATABASE_URL ??
    `postgres://${encodeURIComponent(parsed.DB_USER)}:${encodeURIComponent(parsed.DB_PASSWORD ?? "")}@${parsed.DB_HOST}:${parsed.DB_PORT}/${parsed.DB_NAME}`,
};
export type Config = typeof config;
