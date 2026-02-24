import type { MiddlewareFn } from 'telegraf';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import type { BotContext } from '../types/context';

export const ensureKnownUser: MiddlewareFn<BotContext> = async (ctx, next) => {
  if (!ctx.from) {
    return;
  }

  const telegramId = BigInt(ctx.from.id);

  const user = await prisma.user.upsert({
    where: { telegramId },
    update: {
      telegramUsername: ctx.from.username ?? null,
      firstName: ctx.from.first_name ?? null,
      lastName: ctx.from.last_name ?? null,
    },
    create: {
      telegramId,
      telegramUsername: ctx.from.username ?? null,
      firstName: ctx.from.first_name ?? null,
      lastName: ctx.from.last_name ?? null,
    },
  });

  if (user.isBanned) {
    await ctx.reply('دسترسی شما مسدود شده است.');
    return;
  }

  await next();
};

export const ensureAdmin: MiddlewareFn<BotContext> = async (ctx, next) => {
  if (!ctx.from) {
    return;
  }

  if (!env.ADMIN_TG_ID_LIST.includes(ctx.from.id)) {
    await ctx.reply('این دستور فقط برای ادمین است.');
    return;
  }

  await next();
};
