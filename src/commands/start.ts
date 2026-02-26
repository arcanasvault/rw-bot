import QRCode from 'qrcode';
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

const START_BURST_WINDOW_MS = 15_000;
const START_BURST_LIMIT = 5;
const startBurstMap = new Map<number, { count: number; resetAt: number }>();

const SERVICE_CALLBACK_PREFIX = 'svc';
const SERVICES_LIST_CB = `${SERVICE_CALLBACK_PREFIX}:list`;
const SERVICES_BACK_CB = `${SERVICE_CALLBACK_PREFIX}:back`;

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

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractSubscriptionData(payload: unknown): {
  smartLink: string | null;
  base64: string | null;
  emergencyLinks: string[];
} {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      smartLink: null,
      base64: null,
      emergencyLinks: [],
    };
  }

  const source = payload as Record<string, unknown>;
  const nestedSubscription =
    source.subscription &&
    typeof source.subscription === 'object' &&
    !Array.isArray(source.subscription)
      ? (source.subscription as Record<string, unknown>)
      : null;

  const smartLink =
    asString(source.subscriptionUrl) ??
    asString(source.subscription_url) ??
    asString(source.url) ??
    asString(source.link) ??
    (nestedSubscription ? asString(nestedSubscription.url) : null);

  const base64 =
    asString(source.base64) ??
    asString(source.subscriptionBase64) ??
    (nestedSubscription ? asString(nestedSubscription.base64) : null);

  const emergencyLinks =
    asStringArray(source.links).length > 0
      ? asStringArray(source.links)
      : nestedSubscription
        ? asStringArray(nestedSubscription.links)
        : [];

  return {
    smartLink,
    base64,
    emergencyLinks,
  };
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

async function getOwnedService(
  telegramId: number,
  serviceId: string,
): Promise<{
  id: string;
  name: string;
  remnaUsername: string;
  remnaUserUuid: string;
  expireAt: Date;
  trafficLimitBytes: bigint;
  lastKnownUsedBytes: bigint;
  subscriptionUrl: string | null;
} | null> {
  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    select: { id: true },
  });
  if (!user) {
    return null;
  }

  return prisma.service.findFirst({
    where: {
      id: serviceId,
      userId: user.id,
      isTest: false,
    },
    select: {
      id: true,
      name: true,
      remnaUsername: true,
      remnaUserUuid: true,
      expireAt: true,
      trafficLimitBytes: true,
      lastKnownUsedBytes: true,
      subscriptionUrl: true,
    },
  });
}

async function getOwnedServiceWithPlan(telegramId: number, serviceId: string) {
  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    select: { id: true },
  });
  if (!user) {
    return null;
  }

  return prisma.service.findFirst({
    where: {
      id: serviceId,
      userId: user.id,
      isTest: false,
    },
    include: { plan: true },
  });
}

async function renderServicesList(ctx: BotContext, editCurrentMessage = false): Promise<void> {
  if (!ctx.from) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(ctx.from.id) },
    include: {
      services: {
        where: { isTest: false },
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!user || user.services.length === 0) {
    if (editCurrentMessage) {
      await ctx.answerCbQuery();
      await ctx.reply('شما سرویس خریداری شده‌ای ندارید');
      return;
    }
    await ctx.reply('شما سرویس خریداری شده‌ای ندارید');
    return;
  }

  for (const service of user.services) {
    try {
      const remote = await remnawaveService.getUserByUsername(service.remnaUsername);
      await prisma.service.update({
        where: { id: service.id },
        data: {
          trafficLimitBytes: BigInt(remote.trafficLimitBytes ?? Number(service.trafficLimitBytes)),
          lastKnownUsedBytes: BigInt(
            remote.userTraffic.usedTrafficBytes ?? Number(service.lastKnownUsedBytes),
          ),
          expireAt: remote.expireAt ?? service.expireAt,
          subscriptionUrl: remote.subscriptionUrl ?? service.subscriptionUrl,
        },
      });
    } catch (error) {
      logger.warn(`services-list sync failed service=${service.id} error=${String(error)}`);
    }
  }

  const keyboard = Markup.inlineKeyboard(
    user.services.map((service) => {
      const label = service.plan?.displayName ?? service.name;
      return [Markup.button.callback(label, `${SERVICE_CALLBACK_PREFIX}:item:${service.id}`)];
    }),
  );

  if (editCurrentMessage && 'editMessageText' in ctx) {
    await ctx.editMessageText('سرویس‌های شما:', {
      reply_markup: keyboard.reply_markup,
    });
    await ctx.answerCbQuery();
    return;
  }

  await ctx.reply('سرویس‌های شما:', {
    reply_markup: keyboard.reply_markup,
  });
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

      // Referral flow is intentionally disabled for now.
      // if (setting.enableReferrals) {
      //   const payload = extractStartPayload(ctx.message?.text ?? '');
      //   const referralId = parseReferral(payload);
      //   ...
      // }
      void user;

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
    await renderServicesList(ctx);
  });

  bot.action(SERVICES_LIST_CB, async (ctx) => {
    await renderServicesList(ctx, true);
  });

  bot.action(SERVICES_BACK_CB, async (ctx) => {
    await renderServicesList(ctx, true);
  });

  bot.action(/^svc:item:(.+)$/, async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const serviceId = ctx.match[1];
    const service = await getOwnedService(ctx.from.id, serviceId);
    if (!service) {
      await ctx.answerCbQuery('سرویس نامعتبر است.');
      return;
    }

    let usedBytes = service.lastKnownUsedBytes;
    let limitBytes = service.trafficLimitBytes;
    let expireAt = service.expireAt;

    try {
      const remote = await remnawaveService.getUserByUsername(service.remnaUsername);
      usedBytes = BigInt(remote.userTraffic.usedTrafficBytes ?? Number(service.lastKnownUsedBytes));
      limitBytes = BigInt(remote.trafficLimitBytes ?? Number(service.trafficLimitBytes));
      expireAt = remote.expireAt ?? service.expireAt;

      await prisma.service.update({
        where: { id: service.id },
        data: {
          lastKnownUsedBytes: usedBytes,
          trafficLimitBytes: limitBytes,
          expireAt,
          subscriptionUrl: remote.subscriptionUrl ?? service.subscriptionUrl,
        },
      });
    } catch {
      // Fallback to last known data in DB.
    }

    const remainBytes = limitBytes > usedBytes ? limitBytes - usedBytes : BigInt(0);
    const remainGb = Math.floor(bytesToGb(remainBytes));
    const remainDays = Math.max(0, daysLeft(expireAt));

    await ctx.editMessageText(
      `سرویس: ${service.name}\nحجم باقیمانده: ${remainGb} گیگابایت\nروز باقی مانده: ${remainDays}`,
      {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('لینک هوشمند', `svc:smart:${service.id}`)],
          [Markup.button.callback('اشتراک QR', `svc:qr:${service.id}`)],
          [Markup.button.callback('لینک اضطراری', `svc:emergency:${service.id}`)],
          [Markup.button.callback('تمدید سرویس', `svc:renew:${service.id}`)],
          [Markup.button.callback('بازگشت', SERVICES_BACK_CB)],
        ]).reply_markup,
      },
    );

    await ctx.answerCbQuery();
  });

  bot.action(/^svc:smart:(.+)$/, async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const service = await getOwnedService(ctx.from.id, ctx.match[1]);
    if (!service) {
      await ctx.answerCbQuery('سرویس نامعتبر است.');
      return;
    }

    await ctx.answerCbQuery();
    try {
      const remote = await remnawaveService.getSubscriptionByUuid(service.remnaUserUuid);
      const parsed = extractSubscriptionData(remote);
      const smart = parsed.smartLink ?? parsed.base64;

      if (!smart) {
        await ctx.reply('لینک هوشمند برای این سرویس یافت نشد.');
        return;
      }

      await prisma.service.update({
        where: { id: service.id },
        data: { subscriptionUrl: parsed.smartLink ?? service.subscriptionUrl },
      });

      await ctx.reply(`لینک هوشمند:\n${smart}`);
    } catch (error) {
      logger.error(`smart-link fetch failed service=${service.id} error=${String(error)}`);
      await ctx.reply('دریافت لینک هوشمند ناموفق بود.');
    }
  });

  bot.action(/^svc:emergency:(.+)$/, async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const service = await getOwnedService(ctx.from.id, ctx.match[1]);
    if (!service) {
      await ctx.answerCbQuery('سرویس نامعتبر است.');
      return;
    }

    await ctx.answerCbQuery();
    try {
      const remote = await remnawaveService.getSubscriptionByUuid(service.remnaUserUuid);
      const parsed = extractSubscriptionData(remote);

      if (!parsed.emergencyLinks.length) {
        await ctx.reply('لینک اضطراری برای این سرویس یافت نشد.');
        return;
      }

      await ctx.reply(`لینک‌های اضطراری ${service.name}:`);
      for (const link of parsed.emergencyLinks) {
        await ctx.reply(link);
      }
    } catch (error) {
      logger.error(`emergency-links fetch failed service=${service.id} error=${String(error)}`);
      await ctx.reply('دریافت لینک اضطراری ناموفق بود.');
    }
  });

  bot.action(/^svc:qr:(.+)$/, async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const service = await getOwnedService(ctx.from.id, ctx.match[1]);
    if (!service) {
      await ctx.answerCbQuery('سرویس نامعتبر است.');
      return;
    }

    await ctx.answerCbQuery();
    try {
      const remote = await remnawaveService.getSubscriptionByUuid(service.remnaUserUuid);
      const parsed = extractSubscriptionData(remote);
      const qrSource = parsed.smartLink ?? parsed.emergencyLinks[0] ?? parsed.base64;

      if (!qrSource) {
        await ctx.reply('داده‌ای برای ساخت QR یافت نشد.');
        return;
      }

      const qrBuffer = await QRCode.toBuffer(qrSource, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 700,
      });

      await ctx.replyWithPhoto(
        { source: qrBuffer },
        {
          caption: `QR اشتراک سرویس ${service.name}`,
        },
      );
    } catch (error) {
      logger.error(`subscription-qr failed service=${service.id} error=${String(error)}`);
      await ctx.reply('ساخت QR ناموفق بود.');
    }
  });

  bot.action(/^svc:renew:(.+)$/, async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const service = await getOwnedServiceWithPlan(ctx.from.id, ctx.match[1]);
    if (!service) {
      await ctx.answerCbQuery('سرویس نامعتبر است.');
      return;
    }

    if (!service.plan) {
      await ctx.answerCbQuery();
      await ctx.reply('برای این سرویس امکان تمدید وجود ندارد.');
      return;
    }

    await ctx.answerCbQuery();
    await ctx.reply(
      `تمدید سرویس ${service.name}\nمبلغ: ${formatTomans(service.plan.priceTomans)}\nروش پرداخت را انتخاب کنید.`,
    );
    await ctx.scene.enter('renew-wizard', { serviceId: service.id });
  });

  bot.hears(fa.menu.wallet, async (ctx) => {
    await showWallet(ctx);
  });

  bot.command('hidemenu', async (ctx) => {
    await ctx.reply('منو مخفی شد.', {
      reply_markup: {
        remove_keyboard: true,
      },
    });
  });

  bot.command('showmenu', async (ctx) => {
    await showMainMenu(ctx, 'منوی اصلی نمایش داده شد.');
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
