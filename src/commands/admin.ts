import {
  AffiliateRewardType,
  PaymentGateway,
  PaymentStatus,
  PaymentType,
  Prisma,
  PromoType,
  WalletTransactionType,
} from '@prisma/client';
import { Markup, Telegraf } from 'telegraf';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { paymentOrchestrator } from '../services/payment-orchestrator';
import { sendPurchaseAccessByPayment } from '../services/purchase-delivery';
import { walletService } from '../services/wallet';
import type { BotContext } from '../types/context';
import { formatTomans } from '../utils/currency';

function isAdmin(ctx: BotContext): boolean {
  return Boolean(ctx.from && env.ADMIN_TG_ID_LIST.includes(ctx.from.id));
}

async function ensureAdminUser(ctx: BotContext): Promise<string | null> {
  if (!ctx.from) {
    return null;
  }

  const user = await prisma.user.upsert({
    where: { telegramId: BigInt(ctx.from.id) },
    update: {},
    create: {
      telegramId: BigInt(ctx.from.id),
      firstName: ctx.from.first_name ?? null,
      telegramUsername: ctx.from.username ?? null,
    },
  });

  return user.id;
}

function getArgs(text: string): string[] {
  return text.trim().split(/\s+/).slice(1);
}

function getTextAfterCommand(text: string): string {
  const parts = text.trim().split(' ');
  if (parts.length <= 1) {
    return '';
  }

  return parts.slice(1).join(' ').trim();
}

function asPositiveInt(input: string | undefined): number | null {
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function asPositiveFloat(input: string | undefined): number | null {
  const value = Number.parseFloat(input ?? '');
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function parseListLimit(input: string | undefined, fallback = 20): number {
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return Math.min(value, 100);
}

const TEHRAN_TIME_ZONE = 'Asia/Tehran';
const SALES_PAYMENT_TYPES = [PaymentType.PURCHASE, PaymentType.RENEWAL] as const;

function getTimeZoneDateParts(date: Date, timeZone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return formatter.formatToParts(date).reduce<Record<string, number>>((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = Number(part.value);
    }
    return acc;
  }, {});
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getTimeZoneDateParts(date, timeZone);
  const utcFromTzParts = Date.UTC(
    parts.year,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );

  return utcFromTzParts - date.getTime();
}

function getStartOfTodayInTimeZone(timeZone: string): Date {
  const now = new Date();
  const parts = getTimeZoneDateParts(now, timeZone);
  const utcGuess = Date.UTC(parts.year, (parts.month ?? 1) - 1, parts.day ?? 1, 0, 0, 0);
  const offset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offset);
}

function formatGb(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatUserLabel(telegramId: bigint, telegramUsername: null | string): string {
  if (telegramUsername) {
    return `${telegramId.toString()} (@${telegramUsername})`;
  }
  return telegramId.toString();
}

async function buildSalesReport(input: { from: Date; to: Date }) {
  const where: Prisma.PaymentWhereInput = {
    status: PaymentStatus.SUCCESS,
    type: { in: [...SALES_PAYMENT_TYPES] },
    createdAt: {
      gte: input.from,
      lte: input.to,
    },
  };

  const [aggregate, groupedByPlan] = await Promise.all([
    prisma.payment.aggregate({
      where,
      _count: { _all: true },
      _sum: { amountTomans: true },
    }),
    prisma.payment.groupBy({
      by: ['planId'],
      where,
      _count: { _all: true },
      _sum: { amountTomans: true },
    }),
  ]);

  const planIds = groupedByPlan
    .map((item) => item.planId)
    .filter((planId): planId is string => Boolean(planId));

  const plans = planIds.length
    ? await prisma.plan.findMany({
        where: { id: { in: planIds } },
        select: { id: true, displayName: true, trafficGb: true },
      })
    : [];

  const planMap = new Map(plans.map((plan) => [plan.id, plan]));

  const planBreakdown = groupedByPlan.map((item) => {
    const plan = item.planId ? planMap.get(item.planId) : null;
    const purchases = item._count._all;
    const totalGb = plan ? plan.trafficGb * purchases : 0;

    return {
      planName: plan?.displayName ?? 'پلن حذف شده/نامشخص',
      purchases,
      revenueTomans: item._sum.amountTomans ?? 0,
      totalGb,
    };
  });

  planBreakdown.sort((a, b) => b.revenueTomans - a.revenueTomans);

  return {
    totalRevenueTomans: aggregate._sum.amountTomans ?? 0,
    purchases: aggregate._count._all,
    totalGb: planBreakdown.reduce((sum, item) => sum + item.totalGb, 0),
    planBreakdown,
  };
}

async function sendSalesReport(ctx: BotContext, input: { from: Date; to: Date; title: string }) {
  const report = await buildSalesReport({ from: input.from, to: input.to });

  const lines = [
    `${input.title}`,
    `💵 درآمد کل: ${formatTomans(report.totalRevenueTomans)}`,
    `🌐 مجموع حجم فروخته‌شده: ${formatGb(report.totalGb)} GB`,
    `🧾 تعداد خرید/تمدید موفق: ${report.purchases}`,
    '',
    '📦 تفکیک بر اساس پلن:',
  ];

  if (report.planBreakdown.length === 0) {
    lines.push('— هیچ داده‌ای در این بازه ثبت نشده است.');
  } else {
    report.planBreakdown.forEach((item, index) => {
      lines.push(
        `${index + 1}. ${item.planName} | ${item.purchases} خرید | ${formatGb(item.totalGb)} GB | ${formatTomans(item.revenueTomans)}`,
      );
    });
  }

  await ctx.reply(lines.join('\n'));
}

async function sendStats(ctx: BotContext): Promise<void> {
  const now = new Date();

  const [usersCount, servicesCount, activeSubsCount, pendingManualCount, totalSalesAgg, setting] =
    await Promise.all([
      prisma.user.count(),
      prisma.service.count(),
      prisma.service.count({
        where: {
          isActive: true,
          expireAt: { gt: now },
        },
      }),
      prisma.payment.count({
        where: { status: PaymentStatus.WAITING_REVIEW },
      }),
      prisma.payment.aggregate({
        _sum: { amountTomans: true },
        where: {
          status: PaymentStatus.SUCCESS,
          type: { in: [PaymentType.PURCHASE, PaymentType.RENEWAL] },
        },
      }),
      prisma.setting.findUnique({
        where: { id: 1 },
        select: {
          enableNewPurchases: true,
          enableRenewals: true,
        },
      }),
    ]);

  const totalSales = totalSalesAgg._sum.amountTomans ?? 0;

  await ctx.reply(
    [
      `👥 تعداد کاربران: ${usersCount}`,
      `📦 تعداد سرویس ها: ${servicesCount}`,
      `🟢 اشتراک فعال: ${activeSubsCount}`,
      `💰 فروش کل: ${formatTomans(totalSales)}`,
      `🧾 رسید در انتظار بررسی: ${pendingManualCount}`,
      `🛒 خرید جدید: ${(setting?.enableNewPurchases ?? true) ? 'فعال' : 'غیرفعال'}`,
      `🔄 تمدید: ${(setting?.enableRenewals ?? true) ? 'فعال' : 'غیرفعال'}`,
    ].join('\n'),
  );
}

export function registerAdminCommands(bot: Telegraf<BotContext>): void {
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply('🔐 این دستور فقط برای ادمین است.');
      return;
    }

    await ctx.reply('🛠️ پنل ادمین', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('📊 آمار کلی', 'admin_stats')],
        [Markup.button.callback('🧾 پرداخت های دستی', 'admin_manuals')],
        [Markup.button.callback('🧩 لیست پلن ها', 'admin_plans')],
      ]).reply_markup,
    });

    await ctx.reply(
      [
        '📋 دستورات ادمین:',
        '/stats',
        '/users 20',
        '/services 20',
        '/payments 20',
        '/ban <tg_id>',
        '/unban <tg_id>',
        '/wallet <tg_id> <amount>',
        '/setactiveplans <telegram_id> <limit|null>',
        '/manuals',
        '/salestoday',
        '/sales24h',
        '/salesweek',
        '/salesmonth',
        '/topusers [N]',
        '/broadcast <message>',
        '/plans',
        '/addplan',
        '/editplan',
        '/delplan <plan_id>',
        '/settest <traffic_gb> <days>',
        '/settestinternalsquad <id(s)>',
        '/testtoggle <on|off>',
        '/resettest <tg_id>',
        '/resetalltests',
        '/togglemanual',
        '/toggletetra',
        '/togglesales',
        '/togglerenew',
        '/setnotify <days> <gb>',
        '/setaffiliate <fixed|percent> <value>',
        '/addpromo',
        '/listpromos',
        '/togglepromo <code>',
        '/deletepromo <code>',
      ].join('\n'),
    );
  });

  bot.action('admin_stats', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('⛔ دسترسی ندارید');
      return;
    }

    await ctx.answerCbQuery();
    await sendStats(ctx);
  });

  bot.command('stats', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    await sendStats(ctx);
  });

  bot.command('users', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const limit = parseListLimit(getArgs(ctx.message.text)[0]);
    const users = await prisma.user.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    if (!users.length) {
      await ctx.reply('📭 کاربری یافت نشد.');
      return;
    }

    const lines = users.map(
      (u) =>
        `${u.telegramId.toString()} | بن: ${u.isBanned ? 'بله' : 'خیر'} | کیف پول: ${formatTomans(u.walletBalanceTomans)} | حداکثر سرویس فعال: ${u.maxActivePlans ?? '∞'}`,
    );

    await ctx.reply(lines.join('\n'));
  });

  bot.command('services', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const limit = parseListLimit(getArgs(ctx.message.text)[0]);
    const services = await prisma.service.findMany({
      take: limit,
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!services.length) {
      await ctx.reply('📭 سرویسی یافت نشد.');
      return;
    }

    const lines = services.map(
      (s) =>
        `${s.id} | ${s.name} | کاربر: ${s.user.telegramId.toString()} | انقضا: ${s.expireAt.toISOString().slice(0, 10)}`,
    );

    await ctx.reply(lines.join('\n'));
  });

  bot.command('payments', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const limit = parseListLimit(getArgs(ctx.message.text)[0]);
    const payments = await prisma.payment.findMany({
      take: limit,
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!payments.length) {
      await ctx.reply('📭 پرداختی یافت نشد.');
      return;
    }

    const lines = payments.map(
      (p) =>
        `${p.id} | ${p.user.telegramId.toString()} | ${p.type} | ${p.gateway} | ${p.status} | ${formatTomans(p.amountTomans)}`,
    );

    await ctx.reply(lines.join('\n'));
  });

  bot.command('ban', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const args = getArgs(ctx.message.text);
    const tgId = Number(args[0]);
    if (!tgId) {
      await ctx.reply('🧾 فرمت درست: /ban <tg_id>');
      return;
    }

    await prisma.user.updateMany({
      where: { telegramId: BigInt(tgId) },
      data: { isBanned: true },
    });

    await ctx.reply('🚫 کاربر بن شد.');
  });

  bot.command('unban', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const args = getArgs(ctx.message.text);
    const tgId = Number(args[0]);
    if (!tgId) {
      await ctx.reply('🧾 فرمت درست: /unban <tg_id>');
      return;
    }

    await prisma.user.updateMany({
      where: { telegramId: BigInt(tgId) },
      data: { isBanned: false },
    });

    await ctx.reply('✅ بن کاربر برداشته شد.');
  });

  bot.command('wallet', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const args = getArgs(ctx.message.text);
    const tgId = Number(args[0]);
    const amount = Number(args[1]);

    if (!tgId || !Number.isInteger(amount) || amount === 0) {
      await ctx.reply('🧾 فرمت درست: /wallet <tg_id> <amount> (مثال: +50000 یا -30000)');
      return;
    }

    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(tgId) } });
    if (!user) {
      await ctx.reply('⚠️ کاربر پیدا نشد.');
      return;
    }

    try {
      if (amount > 0) {
        await walletService.credit({
          userId: user.id,
          amountTomans: amount,
          type: WalletTransactionType.ADMIN_ADJUST,
          description: 'تنظیم دستی کیف پول توسط ادمین',
        });
      } else {
        await walletService.debit({
          userId: user.id,
          amountTomans: Math.abs(amount),
          type: WalletTransactionType.ADMIN_ADJUST,
          description: 'کسر دستی کیف پول توسط ادمین',
        });
      }
    } catch (error) {
      await ctx.reply(`❌ خطا در بروزرسانی کیف پول: ${String(error)}`);
      return;
    }

    await ctx.reply('✅ کیف پول کاربر بروزرسانی شد.');
  });

  bot.command('setactiveplans', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const [telegramIdRaw, limitRaw] = getArgs(ctx.message.text);
    const telegramId = Number(telegramIdRaw);

    if (!Number.isInteger(telegramId) || telegramId <= 0 || !limitRaw) {
      await ctx.reply('🧾 فرمت درست: /setactiveplans <telegram_id> <limit|null>');
      return;
    }

    const normalizedLimit = limitRaw.trim().toLowerCase();
    const shouldClearLimit = ['null', 'none', '-', 'off', 'remove'].includes(normalizedLimit);

    let maxActivePlans: null | number = null;
    if (!shouldClearLimit) {
      const parsedLimit = Number(limitRaw);
      if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
        await ctx.reply('⚠️ limit باید عدد صحیح مثبت باشد یا null.');
        return;
      }
      maxActivePlans = parsedLimit;
    }

    await prisma.user.upsert({
      where: { telegramId: BigInt(telegramId) },
      update: { maxActivePlans },
      create: {
        telegramId: BigInt(telegramId),
        maxActivePlans,
      },
    });

    await ctx.reply(
      maxActivePlans
        ? `✅ محدودیت سرویس فعال کاربر ${telegramId} روی ${maxActivePlans} تنظیم شد.`
        : `✅ محدودیت سرویس فعال کاربر ${telegramId} حذف شد.`,
    );
  });

  bot.command('salestoday', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    const from = getStartOfTodayInTimeZone(TEHRAN_TIME_ZONE);
    const to = new Date();
    await sendSalesReport(ctx, { from, to, title: '📅 گزارش فروش امروز' });
  });

  bot.command('sales24h', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    const to = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
    await sendSalesReport(ctx, { from, to, title: '⏱ گزارش فروش 24 ساعت اخیر' });
  });

  bot.command('salesweek', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    await sendSalesReport(ctx, { from, to, title: '🗓 گزارش فروش 7 روز اخیر' });
  });

  bot.command('salesmonth', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    await sendSalesReport(ctx, { from, to, title: '📆 گزارش فروش 30 روز اخیر' });
  });

  bot.command('topusers', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const requested = Number(getArgs(ctx.message.text)[0]);
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 100) : 10;

    const grouped = await prisma.payment.groupBy({
      by: ['userId', 'planId'],
      where: {
        status: PaymentStatus.SUCCESS,
        type: { in: [...SALES_PAYMENT_TYPES] },
      },
      _count: { _all: true },
      _sum: { amountTomans: true },
    });

    if (!grouped.length) {
      await ctx.reply('📭 هنوز خرید موفقی ثبت نشده است.');
      return;
    }

    const userIds = [...new Set(grouped.map((item) => item.userId))];
    const planIds = [
      ...new Set(grouped.map((item) => item.planId).filter((planId): planId is string => !!planId)),
    ];

    const [users, plans] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, telegramId: true, telegramUsername: true },
      }),
      planIds.length
        ? prisma.plan.findMany({
            where: { id: { in: planIds } },
            select: { id: true, trafficGb: true },
          })
        : Promise.resolve([]),
    ]);

    const userMap = new Map(users.map((user) => [user.id, user]));
    const planMap = new Map(plans.map((plan) => [plan.id, plan]));

    const totals = new Map<
      string,
      { purchases: number; totalGb: number; totalSpentTomans: number; userLabel: string }
    >();

    grouped.forEach((item) => {
      const user = userMap.get(item.userId);
      if (!user) {
        return;
      }

      const current = totals.get(item.userId) ?? {
        purchases: 0,
        totalGb: 0,
        totalSpentTomans: 0,
        userLabel: formatUserLabel(user.telegramId, user.telegramUsername),
      };

      const purchases = item._count._all;
      const spent = item._sum.amountTomans ?? 0;
      const planTraffic = item.planId ? (planMap.get(item.planId)?.trafficGb ?? 0) : 0;

      current.purchases += purchases;
      current.totalSpentTomans += spent;
      current.totalGb += planTraffic * purchases;

      totals.set(item.userId, current);
    });

    const ranking = [...totals.values()]
      .sort((a, b) => b.totalGb - a.totalGb || b.totalSpentTomans - a.totalSpentTomans)
      .slice(0, limit);

    if (!ranking.length) {
      await ctx.reply('📭 هنوز خرید موفقی ثبت نشده است.');
      return;
    }

    const lines = [`🏆 ${limit} کاربر برتر بر اساس مجموع حجم خرید`];
    ranking.forEach((row, index) => {
      lines.push(
        `${index + 1}. 👤 ${row.userLabel} | 🌐 ${formatGb(row.totalGb)} GB | 💵 ${formatTomans(row.totalSpentTomans)} | 🧾 ${row.purchases} خرید`,
      );
    });

    await ctx.reply(lines.join('\n'));
  });

  bot.command('manuals', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    const pending = await prisma.payment.findMany({
      where: {
        gateway: PaymentGateway.MANUAL,
        status: PaymentStatus.WAITING_REVIEW,
      },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
      take: 30,
    });

    if (!pending.length) {
      await ctx.reply('📭 رسید در انتظار بررسی وجود ندارد.');
      return;
    }

    for (const payment of pending) {
      await ctx.reply(
        `🧾 پرداخت: ${payment.id}\n👤 کاربر: ${payment.user.telegramId.toString()}\n💰 مبلغ: ${formatTomans(payment.amountTomans)}`,
        {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('✅ تایید', `manual_approve:${payment.id}`)],
            [Markup.button.callback('🚫 رد', `manual_deny:${payment.id}`)],
          ]).reply_markup,
        },
      );
    }
  });

  bot.action('admin_manuals', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('⛔ دسترسی ندارید');
      return;
    }

    await ctx.answerCbQuery();
    await ctx.reply('📋 /manuals را اجرا کنید یا از همین لیست پایین استفاده کنید.');
  });

  bot.action('admin_plans', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('⛔ دسترسی ندارید');
      return;
    }

    const plans = await prisma.plan.findMany({ orderBy: { createdAt: 'desc' } });
    await ctx.answerCbQuery();

    if (!plans.length) {
      await ctx.reply('📭 پلنی وجود ندارد.');
      return;
    }

    await ctx.reply(
      plans
        .map(
          (p) =>
            `${p.id}\n${p.displayName} (${p.name}) | ${p.trafficGb}GB | ${p.durationDays} روز | ${formatTomans(p.priceTomans)} | squad: ${p.internalSquadId} | فعال: ${p.isActive ? 'بله' : 'خیر'}`,
        )
        .join('\n\n'),
    );
  });

  bot.action(/^manual_approve:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('⛔ دسترسی ندارید');
      return;
    }

    const paymentId = ctx.match[1];
    const adminUserId = await ensureAdminUser(ctx);
    if (!adminUserId) {
      await ctx.answerCbQuery('❌ خطا');
      return;
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { user: true },
    });

    if (!payment || payment.status !== PaymentStatus.WAITING_REVIEW) {
      await ctx.answerCbQuery('⚠️ پرداخت قابل تایید نیست');
      return;
    }

    try {
      await paymentOrchestrator.processSuccessfulPayment(payment.id);
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          reviewedByAdminId: adminUserId,
          reviewNote: 'تایید دستی توسط ادمین',
        },
      });

      await ctx.answerCbQuery('✅ تایید شد');
      if (payment.type === PaymentType.PURCHASE) {
        await sendPurchaseAccessByPayment(ctx.telegram, payment.id);
      } else {
        await ctx.telegram.sendMessage(
          Number(payment.user.telegramId),
          '✅ پرداخت شما تایید شد و سرویس/کیف پول بروزرسانی شد.',
        );
      }
    } catch (error) {
      logger.error(`manual approve failed paymentId=${payment.id} error=${String(error)}`);
      await ctx.answerCbQuery('❌ خطا در تایید');
      await ctx.reply('❌ خطا در تایید پرداخت. وضعیت پرداخت به ناموفق تغییر کرد.');
      await ctx.telegram.sendMessage(
        Number(payment.user.telegramId),
        '⚠️ پرداخت شما با خطا مواجه شد. لطفا با پشتیبانی تماس بگیرید.',
      );
    }
  });

  bot.action(/^manual_deny:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('⛔ دسترسی ندارید');
      return;
    }

    const paymentId = ctx.match[1];
    const adminUserId = await ensureAdminUser(ctx);
    if (!adminUserId) {
      await ctx.answerCbQuery('❌ خطا');
      return;
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { user: true },
    });

    if (!payment || payment.status !== PaymentStatus.WAITING_REVIEW) {
      await ctx.answerCbQuery('⚠️ پرداخت قابل رد نیست');
      return;
    }

    await paymentOrchestrator.rejectManualPayment(payment.id, adminUserId, 'رد دستی توسط ادمین');
    await ctx.answerCbQuery('🚫 رد شد');
    await ctx.telegram.sendMessage(
      Number(payment.user.telegramId),
      '🚫 رسید شما رد شد. با پشتیبانی تماس بگیرید.',
    );
  });

  bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const text = getTextAfterCommand(ctx.message.text);
    if (!text) {
      await ctx.reply('🧾 فرمت درست: /broadcast <message>');
      return;
    }

    if (text.length > 4000) {
      await ctx.reply('⚠️ متن پیام همگانی بیش از حد طولانی است.');
      return;
    }

    const users = await prisma.user.findMany({
      where: { isBanned: false },
      select: { telegramId: true },
    });

    let success = 0;
    let failed = 0;

    for (const user of users) {
      try {
        await ctx.telegram.sendMessage(Number(user.telegramId), text);
        success += 1;
      } catch {
        failed += 1;
      }
    }

    await ctx.reply(`📣 ارسال همگانی انجام شد. موفق: ${success} | ناموفق: ${failed}`);
  });

  bot.command('plans', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    const plans = await prisma.plan.findMany({ orderBy: { createdAt: 'desc' } });

    if (!plans.length) {
      await ctx.reply('📭 پلنی وجود ندارد.');
      return;
    }

    await ctx.reply(
      plans
        .map(
          (p) =>
            `${p.id}\n${p.displayName} (${p.name}) | ${p.trafficGb}GB | ${p.durationDays} روز | ${formatTomans(p.priceTomans)} | squad: ${p.internalSquadId} | فعال: ${p.isActive ? 'بله' : 'خیر'}`,
        )
        .join('\n\n'),
    );
  });

  bot.command('addplan', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    await ctx.scene.enter('admin-add-plan-wizard');
  });

  bot.command('editplan', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    await ctx.scene.enter('admin-edit-plan-wizard');
  });

  bot.command('delplan', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const id = getArgs(ctx.message.text)[0];
    if (!id) {
      await ctx.reply('🧾 فرمت درست: /delplan <plan_id>');
      return;
    }

    try {
      await prisma.plan.delete({ where: { id } });
      await ctx.reply('✅ پلن حذف شد.');
    } catch {
      await ctx.reply('❌ حذف پلن ناموفق بود.');
    }
  });

  bot.command('settest', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const [trafficGbRaw, daysRaw] = getArgs(ctx.message.text);
    const trafficGb = asPositiveFloat(trafficGbRaw);
    const days = asPositiveFloat(daysRaw);

    if (!trafficGb || !days) {
      await ctx.reply('🧾 فرمت درست: /settest <traffic_gb> <days>');
      return;
    }

    await prisma.setting.upsert({
      where: { id: 1 },
      update: {
        testTrafficBytes: BigInt(Math.floor(trafficGb * 1024 * 1024 * 1024)),
        testDurationDays: days,
      },
      create: {
        id: 1,
        testTrafficBytes: BigInt(Math.floor(trafficGb * 1024 * 1024 * 1024)),
        testDurationDays: days,
      },
    });

    await ctx.reply('✅ تنظیمات سرویس تست بروزرسانی شد.');
  });

  bot.command('settestinternalsquad', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const squadIds = getArgs(ctx.message.text).join(' ').replace(/\s+/g, '');
    if (!squadIds) {
      await ctx.reply('🧾 فرمت درست: /settestinternalsquad <id(s)>');
      return;
    }

    await prisma.setting.upsert({
      where: { id: 1 },
      update: { testInternalSquadId: squadIds },
      create: { id: 1, testInternalSquadId: squadIds },
    });

    await ctx.reply('✅ internal squad تست بروزرسانی شد.');
  });

  bot.command('testtoggle', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const mode = getArgs(ctx.message.text)[0];
    if (!['on', 'off'].includes(mode ?? '')) {
      await ctx.reply('🧾 فرمت درست: /testtoggle <on|off>');
      return;
    }

    await prisma.setting.upsert({
      where: { id: 1 },
      update: { testEnabled: mode === 'on' },
      create: { id: 1, testEnabled: mode === 'on' },
    });

    await ctx.reply(mode === 'on' ? '✅ سرویس تست فعال شد.' : '🚫 سرویس تست غیرفعال شد.');
  });

  bot.command('resettest', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const tgId = Number(getArgs(ctx.message.text)[0]);
    if (!tgId) {
      await ctx.reply('🧾 فرمت درست: /resettest <tg_id>');
      return;
    }

    await prisma.user.updateMany({
      where: { telegramId: BigInt(tgId) },
      data: { usedTestSubscription: false },
    });

    await ctx.reply('✅ وضعیت تست کاربر ریست شد.');
  });

  bot.command('resetalltests', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    const result = await prisma.user.updateMany({
      data: { usedTestSubscription: false },
    });

    await ctx.reply(`✅ وضعیت تست همه کاربران ریست شد. تعداد: ${result.count}`);
  });

  bot.command('togglemanual', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    const setting = await prisma.setting.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });

    const updated = await prisma.setting.update({
      where: { id: 1 },
      data: { enableManualPayment: !setting.enableManualPayment },
    });

    await ctx.reply(
      updated.enableManualPayment ? '✅ پرداخت دستی فعال شد.' : '🚫 پرداخت دستی غیرفعال شد.',
    );
  });

  bot.command('toggletetra', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    const setting = await prisma.setting.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });

    const updated = await prisma.setting.update({
      where: { id: 1 },
      data: { enableTetra98: !setting.enableTetra98 },
    });

    await ctx.reply(
      updated.enableTetra98 ? '✅ پرداخت تترا98 فعال شد.' : '🚫 پرداخت تترا98 غیرفعال شد.',
    );
  });

  bot.command('togglesales', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    const setting = await prisma.setting.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });

    const updated = await prisma.setting.update({
      where: { id: 1 },
      data: { enableNewPurchases: !setting.enableNewPurchases },
    });

    await ctx.reply(
      updated.enableNewPurchases
        ? '✅ خرید جدید فعال شد.'
        : '🚫 در حال حاضر خرید جدید غیرفعال است.',
    );
  });

  bot.command('togglerenew', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    const setting = await prisma.setting.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });

    const updated = await prisma.setting.update({
      where: { id: 1 },
      data: { enableRenewals: !setting.enableRenewals },
    });

    await ctx.reply(
      updated.enableRenewals ? '✅ تمدید فعال شد.' : '🚫 در حال حاضر تمدید غیرفعال است.',
    );
  });

  bot.command('setnotify', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const [daysRaw, gbRaw] = getArgs(ctx.message.text);
    const days = asPositiveInt(daysRaw);
    const gb = asPositiveInt(gbRaw);

    if (!days || !gb) {
      await ctx.reply('🧾 فرمت درست: /setnotify <days> <gb>');
      return;
    }

    await prisma.setting.upsert({
      where: { id: 1 },
      update: {
        notifyDaysLeft: days,
        notifyGbLeft: gb,
      },
      create: {
        id: 1,
        notifyDaysLeft: days,
        notifyGbLeft: gb,
      },
    });

    await ctx.reply('✅ آستانه اعلان بروزرسانی شد.');
  });

  bot.command('setaffiliate', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const [typeRaw, valueRaw] = getArgs(ctx.message.text);
    const value = asPositiveInt(valueRaw);

    if (!['fixed', 'percent'].includes(typeRaw ?? '') || !value) {
      await ctx.reply('🧾 فرمت درست: /setaffiliate <fixed|percent> <value>');
      return;
    }

    if (typeRaw === 'percent' && value > 100) {
      await ctx.reply('⚠️ در حالت درصد، مقدار باید حداکثر 100 باشد.');
      return;
    }

    await prisma.setting.upsert({
      where: { id: 1 },
      update: {
        affiliateRewardType:
          typeRaw === 'fixed' ? AffiliateRewardType.FIXED : AffiliateRewardType.PERCENT,
        affiliateRewardValue: value,
      },
      create: {
        id: 1,
        affiliateRewardType:
          typeRaw === 'fixed' ? AffiliateRewardType.FIXED : AffiliateRewardType.PERCENT,
        affiliateRewardValue: value,
      },
    });

    await ctx.reply('✅ تنظیمات همکاری فروش بروزرسانی شد.');
  });

  bot.command('addpromo', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    await ctx.scene.enter('admin-add-promo-wizard');
  });

  bot.command('listpromos', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    const promos = await prisma.promo.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    if (!promos.length) {
      await ctx.reply('📭 کد تخفیفی ثبت نشده است.');
      return;
    }

    await ctx.reply(
      promos
        .map((promo) => {
          const kind =
            promo.type === PromoType.PERCENT
              ? `درصدی ${promo.value}%`
              : `ثابت ${formatTomans(promo.value)}`;
          const expireText = promo.expiresAt
            ? promo.expiresAt.toISOString().slice(0, 10)
            : 'بدون انقضا';
          return `${promo.code} | ${kind} | استفاده: ${promo.currentUses}/${promo.maxUses} | فعال: ${promo.isActive ? 'بله' : 'خیر'} | انقضا: ${expireText}`;
        })
        .join('\n'),
    );
  });

  bot.command('togglepromo', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const code = (getArgs(ctx.message.text)[0] ?? '').trim().toUpperCase();
    if (!code) {
      await ctx.reply('🧾 فرمت درست: /togglepromo <code>');
      return;
    }

    const promo = await prisma.promo.findUnique({ where: { code } });
    if (!promo) {
      await ctx.reply('⚠️ کد تخفیف پیدا نشد.');
      return;
    }

    const updated = await prisma.promo.update({
      where: { code },
      data: { isActive: !promo.isActive },
    });

    await ctx.reply(updated.isActive ? '✅ کد تخفیف فعال شد.' : '🚫 کد تخفیف غیرفعال شد.');
  });

  bot.command('deletepromo', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const code = (getArgs(ctx.message.text)[0] ?? '').trim().toUpperCase();
    if (!code) {
      await ctx.reply('🧾 فرمت درست: /deletepromo <code>');
      return;
    }

    try {
      await prisma.promo.delete({ where: { code } });
      await ctx.reply('✅ کد تخفیف حذف شد.');
    } catch {
      await ctx.reply('⚠️ کد تخفیف پیدا نشد یا قابل حذف نیست.');
    }
  });
}
