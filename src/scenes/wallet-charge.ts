import { PaymentGateway } from '@prisma/client';
import { Composer, Markup, Scenes } from 'telegraf';
import { env } from '../config/env';
import { AppError } from '../errors/app-error';
import { prisma } from '../lib/prisma';
import { paymentOrchestrator } from '../services/payment-orchestrator';
import type { BotContext } from '../types/context';
import type { WalletWizardState } from '../types/session';
import { formatTomans } from '../utils/currency';

const scene = new Scenes.WizardScene<BotContext>(
  'wallet-charge-wizard',
  async (ctx) => {
    await ctx.reply(
      `💸 مبلغ شارژ را به تومان وارد کنید. حداقل ${formatTomans(env.MIN_WALLET_CHARGE_TOMANS)} و حداکثر ${formatTomans(env.MAX_WALLET_CHARGE_TOMANS)}`,
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('🔢 مبلغ را به صورت عدد ارسال کنید.');
      return;
    }

    const amount = Number(ctx.message.text.replace(/,/g, '').trim());

    if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
      await ctx.reply('⚠️ مبلغ وارد شده معتبر نیست.');
      return;
    }

    if (amount < env.MIN_WALLET_CHARGE_TOMANS || amount > env.MAX_WALLET_CHARGE_TOMANS) {
      await ctx.reply('⚠️ مبلغ خارج از بازه مجاز است.');
      return;
    }

    const state = ctx.wizard.state as WalletWizardState;
    state.amountTomans = amount;

    const setting = await prisma.setting.findUnique({
      where: { id: 1 },
      select: {
        enableTetra98: true,
        enableManualPayment: true,
      },
    });

    const tetraEnabled = setting?.enableTetra98 ?? true;
    const manualEnabled = setting?.enableManualPayment ?? true;

    const paymentButtons = [];

    if (tetraEnabled) {
      paymentButtons.push([
        Markup.button.callback('🌐 پرداخت آنلاین تترا98', 'wallet_gateway:tetra'),
      ]);
    }
    if (manualEnabled) {
      paymentButtons.push([
        Markup.button.callback('💳 پرداخت کارت به کارت', 'wallet_gateway:manual'),
      ]);
    }

    await ctx.reply(
      `✅ مبلغ ${formatTomans(amount)} برای شارژ کیف پول تایید شد. روش پرداخت را انتخاب کنید:`,
      {
        reply_markup: Markup.inlineKeyboard(paymentButtons).reply_markup,
      },
    );

    return ctx.wizard.next();
  },
  new Composer<BotContext>()
    .action(/^wallet_gateway:(tetra|manual)$/, async (ctx) => {
      if (!ctx.from) {
        return;
      }

      const state = ctx.wizard.state as WalletWizardState;
      if (!state.amountTomans) {
        await ctx.answerCbQuery('⚠️ اطلاعات پرداخت ناقص است');
        return ctx.scene.leave();
      }

      const gateway = ctx.match[1] === 'tetra' ? PaymentGateway.TETRA98 : PaymentGateway.MANUAL;

      try {
        const payment = await paymentOrchestrator.createWalletChargePayment({
          telegramId: ctx.from.id,
          amountTomans: state.amountTomans,
          gateway,
        });

        if (gateway === PaymentGateway.TETRA98) {
          const order = await paymentOrchestrator.createTetra98Order(payment.id);
          await ctx.answerCbQuery();
          await ctx.reply(`🌐 برای پرداخت روی لینک زیر بزنید:\n${order.link}`);
          return ctx.scene.leave();
        }

        const setting = await prisma.setting.findUnique({ where: { id: 1 } });
        const cardNumber = setting?.manualCardNumber ?? env.MANUAL_CARD_NUMBER;
        ctx.session.pendingManualPaymentId = payment.id;
        await ctx.answerCbQuery();
        await ctx.reply(
          `💳 لطفا مبلغ ${formatTomans(payment.amountTomans)} را به کارت ${cardNumber} واریز کنید و عکس رسید را ارسال کنید.`,
        );
        return ctx.wizard.next();
      } catch (error) {
        const message =
          error instanceof AppError ? error.message : '❌ خطا در ایجاد پرداخت. لطفا دوباره تلاش کنید.';
        await ctx.answerCbQuery();
        await ctx.reply(message);
        return ctx.scene.leave();
      }
    })
    .on('callback_query', async (ctx) => {
      await ctx.answerCbQuery('💳 روش پرداخت را انتخاب کنید');
    }),
  async (ctx) => {
    const paymentId = ctx.session.pendingManualPaymentId;

    if (!paymentId) {
      await ctx.reply('⚠️ درخواست پرداخت دستی یافت نشد.');
      return ctx.scene.leave();
    }

    if (ctx?.message && 'text' in ctx.message && ctx.message.text.trim() === 'لغو') {
      ctx.session.pendingManualPaymentId = undefined;
      await ctx.reply('🛑 درخواست شما لغو شد.');
      return ctx.scene.leave();
    }

    if (!ctx.message || !('photo' in ctx.message) || !ctx.message.photo.length) {
      await ctx.reply('📷 لطفا عکس رسید را ارسال کنید. برای انصراف، کلمه "لغو" را ارسال کنید.');
      return;
    }

    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    await paymentOrchestrator.submitManualReceipt(paymentId, fileId);

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { user: true },
    });

    if (payment) {
      for (const adminId of env.ADMIN_TG_ID_LIST) {
        await ctx.telegram.sendPhoto(adminId, fileId, {
          caption: `🧾 رسید شارژ کیف پول ثبت شد\n💳 پرداخت: ${payment.id}\n👤 کاربر: ${payment.user.telegramId.toString()}\n💰 مبلغ: ${formatTomans(payment.amountTomans)}`,
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('✅ تایید', `manual_approve:${payment.id}`)],
            [Markup.button.callback('🚫 رد', `manual_deny:${payment.id}`)],
          ]).reply_markup,
        });
      }
    }

    ctx.session.pendingManualPaymentId = undefined;
    await ctx.reply('✅ رسید شما ثبت شد. پس از بررسی ادمین اطلاع رسانی می‌شود.');
    return ctx.scene.leave();
  },
);

export const walletChargeWizardScene = scene;
