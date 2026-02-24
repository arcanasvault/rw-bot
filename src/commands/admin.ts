import {
  AffiliateRewardType,
  PaymentGateway,
  PaymentStatus,
  PaymentType,
  WalletTransactionType,
} from '@prisma/client';
import { Markup, Telegraf } from 'telegraf';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { paymentOrchestrator } from '../services/payment-orchestrator';
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

async function sendStats(ctx: BotContext): Promise<void> {
  const now = new Date();

  const [usersCount, servicesCount, activeSubsCount, pendingManualCount, totalSalesAgg] =
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
    ]);

  const totalSales = totalSalesAgg._sum.amountTomans ?? 0;

  await ctx.reply(
    [
      `تعداد کاربران: ${usersCount}`,
      `تعداد سرویس ها: ${servicesCount}`,
      `اشتراک فعال: ${activeSubsCount}`,
      `فروش کل: ${formatTomans(totalSales)}`,
      `رسید در انتظار بررسی: ${pendingManualCount}`,
    ].join('\n'),
  );
}

export function registerAdminCommands(bot: Telegraf<BotContext>): void {
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply('این دستور فقط برای ادمین است.');
      return;
    }

    await ctx.reply('پنل ادمین', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('آمار کلی', 'admin_stats')],
        [Markup.button.callback('پرداخت های دستی', 'admin_manuals')],
        [Markup.button.callback('لیست پلن ها', 'admin_plans')],
      ]).reply_markup,
    });

    await ctx.reply(
      [
        'دستورات ادمین:',
        '/stats',
        '/users 20',
        '/services 20',
        '/payments 20',
        '/ban <tg_id>',
        '/unban <tg_id>',
        '/wallet <tg_id> <amount>',
        '/manuals',
        '/broadcast <message>',
        '/plans',
        '/addplan name|trafficGb|durationDays|priceTomans',
        '/editplan id|name|trafficGb|durationDays|priceTomans|active0or1',
        '/delplan <plan_id>',
        '/settest <traffic_gb> <days>',
        '/testtoggle <on|off>',
        '/resettest <tg_id>',
        '/setnotify <days> <gb>',
        '/setaffiliate <fixed|percent> <value>',
        '/promoadd code|percent|fixed|uses',
      ].join('\n'),
    );
  });

  bot.action('admin_stats', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('دسترسی ندارید');
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

    const limit = Number(getArgs(ctx.message.text)[0] ?? 20);
    const users = await prisma.user.findMany({
      take: Math.min(Math.max(limit, 1), 100),
      orderBy: { createdAt: 'desc' },
    });

    if (!users.length) {
      await ctx.reply('کاربری یافت نشد.');
      return;
    }

    const lines = users.map(
      (u) =>
        `${u.telegramId.toString()} | بن: ${u.isBanned ? 'بله' : 'خیر'} | کیف پول: ${formatTomans(u.walletBalanceTomans)}`,
    );

    await ctx.reply(lines.join('\n'));
  });

  bot.command('services', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const limit = Number(getArgs(ctx.message.text)[0] ?? 20);
    const services = await prisma.service.findMany({
      take: Math.min(Math.max(limit, 1), 100),
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!services.length) {
      await ctx.reply('سرویسی یافت نشد.');
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

    const limit = Number(getArgs(ctx.message.text)[0] ?? 20);
    const payments = await prisma.payment.findMany({
      take: Math.min(Math.max(limit, 1), 100),
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!payments.length) {
      await ctx.reply('پرداختی یافت نشد.');
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
      await ctx.reply('فرمت درست: /ban <tg_id>');
      return;
    }

    await prisma.user.updateMany({
      where: { telegramId: BigInt(tgId) },
      data: { isBanned: true },
    });

    await ctx.reply('کاربر بن شد.');
  });

  bot.command('unban', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const args = getArgs(ctx.message.text);
    const tgId = Number(args[0]);
    if (!tgId) {
      await ctx.reply('فرمت درست: /unban <tg_id>');
      return;
    }

    await prisma.user.updateMany({
      where: { telegramId: BigInt(tgId) },
      data: { isBanned: false },
    });

    await ctx.reply('بن کاربر برداشته شد.');
  });

  bot.command('wallet', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const args = getArgs(ctx.message.text);
    const tgId = Number(args[0]);
    const amount = Number(args[1]);

    if (!tgId || !Number.isInteger(amount) || amount === 0) {
      await ctx.reply('فرمت درست: /wallet <tg_id> <amount> (مثال: +50000 یا -30000)');
      return;
    }

    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(tgId) } });
    if (!user) {
      await ctx.reply('کاربر پیدا نشد.');
      return;
    }

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

    await ctx.reply('کیف پول کاربر بروزرسانی شد.');
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
      await ctx.reply('رسید در انتظار بررسی وجود ندارد.');
      return;
    }

    for (const payment of pending) {
      await ctx.reply(
        `پرداخت: ${payment.id}\nکاربر: ${payment.user.telegramId.toString()}\nمبلغ: ${formatTomans(payment.amountTomans)}`,
        {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('تایید', `manual_approve:${payment.id}`)],
            [Markup.button.callback('رد', `manual_deny:${payment.id}`)],
          ]).reply_markup,
        },
      );
    }
  });

  bot.action('admin_manuals', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('دسترسی ندارید');
      return;
    }

    await ctx.answerCbQuery();
    await ctx.reply('/manuals را اجرا کنید یا از همین لیست پایین استفاده کنید.');
  });

  bot.action('admin_plans', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('دسترسی ندارید');
      return;
    }

    const plans = await prisma.plan.findMany({ orderBy: { createdAt: 'desc' } });
    await ctx.answerCbQuery();

    if (!plans.length) {
      await ctx.reply('پلنی وجود ندارد.');
      return;
    }

    await ctx.reply(
      plans
        .map(
          (p) =>
            `${p.id}\n${p.name} | ${p.trafficGb}GB | ${p.durationDays} روز | ${formatTomans(p.priceTomans)} | فعال: ${p.isActive ? 'بله' : 'خیر'}`,
        )
        .join('\n\n'),
    );
  });

  bot.action(/^manual_approve:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('دسترسی ندارید');
      return;
    }

    const paymentId = ctx.match[1];
    const adminUserId = await ensureAdminUser(ctx);
    if (!adminUserId) {
      await ctx.answerCbQuery('خطا');
      return;
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { user: true },
    });

    if (!payment || payment.status !== PaymentStatus.WAITING_REVIEW) {
      await ctx.answerCbQuery('پرداخت قابل تایید نیست');
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

      await ctx.answerCbQuery('تایید شد');
      await ctx.telegram.sendMessage(
        Number(payment.user.telegramId),
        'پرداخت شما تایید شد و سرویس/کیف پول بروزرسانی شد.',
      );
    } catch (error) {
      logger.error(`manual approve failed paymentId=${payment.id} error=${String(error)}`);
      await ctx.answerCbQuery('خطا در تایید');
      await ctx.reply('خطا در تایید پرداخت. وضعیت پرداخت به ناموفق تغییر کرد.');
      await ctx.telegram.sendMessage(
        Number(payment.user.telegramId),
        'پرداخت شما با خطا مواجه شد. لطفا با پشتیبانی تماس بگیرید.',
      );
    }
  });

  bot.action(/^manual_deny:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('دسترسی ندارید');
      return;
    }

    const paymentId = ctx.match[1];
    const adminUserId = await ensureAdminUser(ctx);
    if (!adminUserId) {
      await ctx.answerCbQuery('خطا');
      return;
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { user: true },
    });

    if (!payment || payment.status !== PaymentStatus.WAITING_REVIEW) {
      await ctx.answerCbQuery('پرداخت قابل رد نیست');
      return;
    }

    await paymentOrchestrator.rejectManualPayment(payment.id, adminUserId, 'رد دستی توسط ادمین');
    await ctx.answerCbQuery('رد شد');
    await ctx.telegram.sendMessage(Number(payment.user.telegramId), 'رسید شما رد شد. با پشتیبانی تماس بگیرید.');
  });

  bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const text = getTextAfterCommand(ctx.message.text);
    if (!text) {
      await ctx.reply('فرمت درست: /broadcast <message>');
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

    await ctx.reply(`ارسال همگانی انجام شد. موفق: ${success} | ناموفق: ${failed}`);
  });

  bot.command('plans', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    const plans = await prisma.plan.findMany({ orderBy: { createdAt: 'desc' } });

    if (!plans.length) {
      await ctx.reply('پلنی وجود ندارد.');
      return;
    }

    await ctx.reply(
      plans
        .map(
          (p) =>
            `${p.id}\n${p.name} | ${p.trafficGb}GB | ${p.durationDays} روز | ${formatTomans(p.priceTomans)} | فعال: ${p.isActive ? 'بله' : 'خیر'}`,
        )
        .join('\n\n'),
    );
  });

  bot.command('addplan', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const payload = getTextAfterCommand(ctx.message.text);
    const [name, trafficGbRaw, durationDaysRaw, priceRaw] = payload.split('|').map((x) => x?.trim());

    const trafficGb = Number(trafficGbRaw);
    const durationDays = Number(durationDaysRaw);
    const priceTomans = Number(priceRaw);

    if (!name || !trafficGb || !durationDays || !priceTomans) {
      await ctx.reply('فرمت درست: /addplan name|trafficGb|durationDays|priceTomans');
      return;
    }

    await prisma.plan.create({
      data: {
        name,
        trafficGb,
        durationDays,
        priceTomans,
        isActive: true,
      },
    });

    await ctx.reply('پلن اضافه شد.');
  });

  bot.command('editplan', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const payload = getTextAfterCommand(ctx.message.text);
    const [id, name, trafficGbRaw, durationDaysRaw, priceRaw, activeRaw] = payload
      .split('|')
      .map((x) => x?.trim());

    const trafficGb = Number(trafficGbRaw);
    const durationDays = Number(durationDaysRaw);
    const priceTomans = Number(priceRaw);
    const isActive = activeRaw === '1';

    if (!id || !name || !trafficGb || !durationDays || !priceTomans || !['0', '1'].includes(activeRaw ?? '')) {
      await ctx.reply('فرمت درست: /editplan id|name|trafficGb|durationDays|priceTomans|active0or1');
      return;
    }

    await prisma.plan.update({
      where: { id },
      data: { name, trafficGb, durationDays, priceTomans, isActive },
    });

    await ctx.reply('پلن ویرایش شد.');
  });

  bot.command('delplan', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const id = getArgs(ctx.message.text)[0];
    if (!id) {
      await ctx.reply('فرمت درست: /delplan <plan_id>');
      return;
    }

    await prisma.plan.delete({ where: { id } });
    await ctx.reply('پلن حذف شد.');
  });

  bot.command('settest', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const [trafficGbRaw, daysRaw] = getArgs(ctx.message.text);
    const trafficGb = Number(trafficGbRaw);
    const days = Number(daysRaw);

    if (!trafficGb || !days) {
      await ctx.reply('فرمت درست: /settest <traffic_gb> <days>');
      return;
    }

    await prisma.setting.upsert({
      where: { id: 1 },
      update: {
        testTrafficBytes: BigInt(trafficGb * 1024 * 1024 * 1024),
        testDurationDays: days,
      },
      create: {
        id: 1,
        testTrafficBytes: BigInt(trafficGb * 1024 * 1024 * 1024),
        testDurationDays: days,
      },
    });

    await ctx.reply('تنظیمات سرویس تست بروزرسانی شد.');
  });

  bot.command('testtoggle', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const mode = getArgs(ctx.message.text)[0];
    if (!['on', 'off'].includes(mode ?? '')) {
      await ctx.reply('فرمت درست: /testtoggle <on|off>');
      return;
    }

    await prisma.setting.upsert({
      where: { id: 1 },
      update: { testEnabled: mode === 'on' },
      create: { id: 1, testEnabled: mode === 'on' },
    });

    await ctx.reply(mode === 'on' ? 'سرویس تست فعال شد.' : 'سرویس تست غیرفعال شد.');
  });

  bot.command('resettest', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const tgId = Number(getArgs(ctx.message.text)[0]);
    if (!tgId) {
      await ctx.reply('فرمت درست: /resettest <tg_id>');
      return;
    }

    await prisma.user.updateMany({
      where: { telegramId: BigInt(tgId) },
      data: { usedTestSubscription: false },
    });

    await ctx.reply('وضعیت تست کاربر ریست شد.');
  });

  bot.command('setnotify', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const [daysRaw, gbRaw] = getArgs(ctx.message.text);
    const days = Number(daysRaw);
    const gb = Number(gbRaw);

    if (!days || !gb) {
      await ctx.reply('فرمت درست: /setnotify <days> <gb>');
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

    await ctx.reply('آستانه اعلان بروزرسانی شد.');
  });

  bot.command('setaffiliate', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const [typeRaw, valueRaw] = getArgs(ctx.message.text);
    const value = Number(valueRaw);

    if (!['fixed', 'percent'].includes(typeRaw ?? '') || !value) {
      await ctx.reply('فرمت درست: /setaffiliate <fixed|percent> <value>');
      return;
    }

    await prisma.setting.upsert({
      where: { id: 1 },
      update: {
        affiliateRewardType: typeRaw === 'fixed' ? AffiliateRewardType.FIXED : AffiliateRewardType.PERCENT,
        affiliateRewardValue: value,
      },
      create: {
        id: 1,
        affiliateRewardType: typeRaw === 'fixed' ? AffiliateRewardType.FIXED : AffiliateRewardType.PERCENT,
        affiliateRewardValue: value,
      },
    });

    await ctx.reply('تنظیمات همکاری فروش بروزرسانی شد.');
  });

  bot.command('promoadd', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const payload = getTextAfterCommand(ctx.message.text);
    const [codeRaw, percentRaw, fixedRaw, usesRaw] = payload.split('|').map((x) => x?.trim());

    const code = (codeRaw ?? '').toUpperCase();
    const percent = percentRaw ? Number(percentRaw) : 0;
    const fixed = fixedRaw ? Number(fixedRaw) : 0;
    const uses = Number(usesRaw);

    if (!code || (!percent && !fixed) || !uses) {
      await ctx.reply('فرمت درست: /promoadd code|percent|fixed|uses');
      return;
    }

    await prisma.promoCode.create({
      data: {
        code,
        discountPercent: percent || null,
        fixedTomans: fixed || null,
        usesLeft: uses,
        isActive: true,
      },
    });

    await ctx.reply('کد تخفیف ثبت شد.');
  });
}
