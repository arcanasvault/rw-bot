import { Markup, Telegraf } from 'telegraf';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { remnawaveService } from '../services/remnawave';
import type { BotContext } from '../types/context';
import { formatTomans } from '../utils/currency';
import { bytesToGb, daysLeft } from '../utils/format';
import { fa } from '../utils/farsi';
import { showMainMenu } from './common';

function extractStartPayload(text: string): string | null {
  const raw = text.trim();

  const inlineRef = raw.match(/\/start\?(.+)$/);
  if (inlineRef && inlineRef[1]) {
    return inlineRef[1].trim();
  }

  const parts = raw.split(' ');
  if (parts.length < 2) {
    return null;
  }

  return parts.slice(1).join(' ').trim();
}

function parseReferral(payload: string | null): number | null {
  if (!payload) {
    return null;
  }

  const refMatch = payload.match(/ref[_=](\d+)/);
  if (!refMatch) {
    return null;
  }

  return Number(refMatch[1]);
}

function shouldRequireCaptcha(ctx: BotContext): boolean {
  if (!ctx.from) {
    return false;
  }

  return !ctx.from.username;
}

function createCaptcha(): { question: string; answer: string } {
  const a = Math.floor(Math.random() * 8) + 1;
  const b = Math.floor(Math.random() * 8) + 1;
  return {
    question: `${a} + ${b} = ?`,
    answer: String(a + b),
  };
}

const START_BURST_WINDOW_MS = 15_000;
const START_BURST_LIMIT = 5;
const startBurstMap = new Map<number, { count: number; resetAt: number }>();

function isStartBurstLimited(telegramId: number): boolean {
  const now = Date.now();
  const current = startBurstMap.get(telegramId);

  if (!current || now > current.resetAt) {
    startBurstMap.set(telegramId, {
      count: 1,
      resetAt: now + START_BURST_WINDOW_MS,
    });
    return false;
  }

  current.count += 1;
  startBurstMap.set(telegramId, current);
  return current.count > START_BURST_LIMIT;
}

async function showWallet(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(ctx.from.id) },
  });

  if (!user) {
    return;
  }

  await ctx.reply(`موجودی کیف پول شما: ${formatTomans(user.walletBalanceTomans)}`, {
    reply_markup: Markup.inlineKeyboard([[Markup.button.callback('شارژ کیف پول', 'wallet_charge')]])
      .reply_markup,
  });
}

async function showServices(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(ctx.from.id) },
    include: { services: { orderBy: { createdAt: 'desc' } } },
  });

  if (!user || user.services.length === 0) {
    await ctx.reply('شما هنوز سرویسی ندارید.');
    return;
  }

  const lines: string[] = [];

  for (const service of user.services) {
    let usedBytes = service.lastKnownUsedBytes;
    let limitBytes = service.trafficLimitBytes;
    let expireAt = service.expireAt;
    let subscriptionUrl = service.subscriptionUrl;

    try {
      const remote = await remnawaveService.getUserByUsername(service.remnaUsername);
      usedBytes = BigInt(remote.userTraffic.usedTrafficBytes ?? Number(service.lastKnownUsedBytes));
      limitBytes = BigInt(remote.trafficLimitBytes ?? service.trafficLimitBytes);
      expireAt = remote.expireAt ?? service.expireAt;
      subscriptionUrl = remote.subscriptionUrl ?? service.subscriptionUrl;

      await prisma.service.update({
        where: { id: service.id },
        data: {
          lastKnownUsedBytes: usedBytes,
          trafficLimitBytes: limitBytes,
          expireAt,
          subscriptionUrl,
        },
      });
    } catch {
      // If panel read fails, show last saved values.
    }

    const remainBytes = limitBytes > usedBytes ? limitBytes - usedBytes : BigInt(0);

    lines.push(
      [
        `نام: ${service.name}`,
        `حجم باقیمانده: ${Math.floor(bytesToGb(remainBytes))} گیگابایت`,
        `روز باقی مانده: ${Math.max(0, daysLeft(expireAt))}`,
        subscriptionUrl ? `لینک اشتراک: ${subscriptionUrl}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  await ctx.reply(lines.join('\n\n'));
}

export function registerStartHandlers(bot: Telegraf<BotContext>): void {
  bot.start(async (ctx) => {
    if (!ctx.from) {
      return;
    }

    if (isStartBurstLimited(ctx.from.id)) {
      await ctx.reply('تعداد درخواست /start شما زیاد است. لطفا چند ثانیه دیگر تلاش کنید.');
      return;
    }

    try {
      const payload = extractStartPayload(ctx.message?.text ?? '');

      const user = await prisma.user.upsert({
        where: { telegramId: BigInt(ctx.from.id) },
        update: {
          telegramUsername: ctx.from.username ?? null,
          firstName: ctx.from.first_name ?? null,
          lastName: ctx.from.last_name ?? null,
        },
        create: {
          telegramId: BigInt(ctx.from.id),
          telegramUsername: ctx.from.username ?? null,
          firstName: ctx.from.first_name ?? null,
          lastName: ctx.from.last_name ?? null,
        },
      });

      const referralId = parseReferral(payload);
      if (referralId && referralId !== ctx.from.id && !user.referredById) {
        const referrer = await prisma.user.findUnique({
          where: { telegramId: BigInt(referralId) },
          select: { id: true },
        });

        if (referrer) {
          await prisma.user.update({
            where: { id: user.id },
            data: { referredById: referrer.id },
          });
        }
      }

      if (shouldRequireCaptcha(ctx) && !ctx.session.captcha?.verified) {
        const captcha = createCaptcha();
        ctx.session.captcha = {
          answer: captcha.answer,
          verified: false,
        };
        await ctx.reply(`برای تایید هویت عدد را ارسال کنید:\n${captcha.question}`);
        return;
      }

      await showMainMenu(ctx);
    } catch (error) {
      logger.error(`/start failed user=${ctx.from.id} error=${String(error)}`);
      await ctx.reply('در ثبت نام یا بارگذاری منو خطا رخ داد. لطفا دوباره تلاش کنید.');
    }
  });

  bot.hears(fa.menu.myServices, async (ctx) => {
    await showServices(ctx);
  });

  bot.hears(fa.menu.wallet, async (ctx) => {
    await showWallet(ctx);
  });

  bot.hears(fa.menu.invite, async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const link = `https://t.me/${env.BOT_USERNAME}?start=ref_${ctx.from.id}`;
    await ctx.reply(`لینک دعوت شما:\n${link}`);
  });

  bot.hears(fa.menu.support, async (ctx) => {
    const setting = await prisma.setting.findUnique({ where: { id: 1 } });
    const supportHandle = setting?.supportHandle ?? env.ADMIN_TG_HANDLE;
    const handle = supportHandle.startsWith('@') ? supportHandle.slice(1) : supportHandle;

    await ctx.reply('برای پشتیبانی روی دکمه زیر بزنید:', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.url('پشتیبانی', `https://t.me/${handle}`)],
      ]).reply_markup,
    });
  });

  bot.on('text', async (ctx, next) => {
    if (!ctx.session.captcha || ctx.session.captcha.verified) {
      await next();
      return;
    }

    if ((ctx.message.text ?? '').trim() === ctx.session.captcha.answer) {
      ctx.session.captcha.verified = true;
      await showMainMenu(ctx, 'تایید انجام شد.');
      return;
    }

    await ctx.reply('پاسخ اشتباه است. دوباره تلاش کنید.');
  });
}
