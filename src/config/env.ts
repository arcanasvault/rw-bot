import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url(),
  WEBHOOK_PATH: z.string().default('/telegram/webhook'),
  BOT_TOKEN: z.string().min(10),
  BOT_USERNAME: z.string().min(3),
  ADMIN_TG_IDS: z.string().min(1),
  ADMIN_TG_HANDLE: z.string().min(3),
  DATABASE_URL: z.string().min(10),
  REMNAWAVE_URL: z.string().url(),
  REMNAWAVE_TOKEN: z.string().min(10),
  TETRA98_API_KEY: z.string().min(10),
  MANUAL_CARD_NUMBER: z.string().min(8),
  MIN_WALLET_CHARGE_TOMANS: z.coerce.number().int().positive().default(10000),
  MAX_WALLET_CHARGE_TOMANS: z.coerce.number().int().positive().default(10000000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.errors
    .map((err) => `${err.path.join('.')}: ${err.message}`)
    .join('; ');
  throw new Error(`Invalid env vars: ${formatted}`);
}

function parseAdminIds(raw: string): number[] {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value));
}

export const env = {
  ...parsed.data,
  ADMIN_TG_ID_LIST: parseAdminIds(parsed.data.ADMIN_TG_IDS),
};

export type Env = typeof env;
