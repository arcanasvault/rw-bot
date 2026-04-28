import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  APP_URL: z.string().url().optional(),
  BOT_TOKEN: z.string().min(10),
  BOT_USERNAME: z.string().min(3),
  ADMIN_TG_IDS: z.string().min(1),
  ADMIN_TG_HANDLE: z.string().min(3),
  DATABASE_URL: z.string().min(10),
  REMNAWAVE_URL: z.string().url(),
  REMNAWAVE_TOKEN: z.string().min(10),
  REMNAWAVE_SOCKS5_URL: z.string().optional(),
  REMNAWAVE_SOCKS5_HOST: z.string().optional(),
  REMNAWAVE_SOCKS5_PORT: z.coerce.number().int().positive().optional(),
  REMNAWAVE_SOCKS5_USERNAME: z.string().optional(),
  REMNAWAVE_SOCKS5_PASSWORD: z.string().optional(),
  DEFAULT_INTERNAL_SQUAD_ID: z.string().min(1).default('1'),
  LOGO_URL: z.string().url().optional(),
  TETRA98_API_KEY: z.string().min(10),
  MANUAL_CARD_NUMBER: z.string().min(8),
  MANUAL_CARD_HOLDER_NAME: z.string().min(3).optional(),
  MANUAL_PAYMENT_LOWER_THRESHOLD_PERCENT: z.coerce.number().min(0).max(100).default(5),
  MANUAL_PAYMENT_UPPER_THRESHOLD_PERCENT: z.coerce.number().min(0).max(100).default(5),
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

if (parsed.data.MIN_WALLET_CHARGE_TOMANS > parsed.data.MAX_WALLET_CHARGE_TOMANS) {
  throw new Error('Invalid env vars: MIN_WALLET_CHARGE_TOMANS must be <= MAX_WALLET_CHARGE_TOMANS');
}

function parseAdminIds(raw: string): number[] {
  const list = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (list.length === 0) {
    throw new Error('Invalid env vars: ADMIN_TG_IDS must include at least one numeric Telegram ID');
  }

  return list;
}

export const env = {
  ...parsed.data,
  ADMIN_TG_ID_LIST: parseAdminIds(parsed.data.ADMIN_TG_IDS),
};

export type Env = typeof env;
