import { PaymentGateway } from '@prisma/client';
import { Composer, Markup, Scenes } from 'telegraf';
import { env } from '../config/env';
import { AppError } from '../errors/app-error';
import { prisma } from '../lib/prisma';
import type { BotContext } from '../types/context';
import type { BuyWizardState } from '../types/session';
import { formatTomans } from '../utils/currency';
import { paymentOrchestrator } from '../services/payment-orchestrator';
import { sendPurchaseAccessByPayment } from '../services/purchase-delivery';

const scene = new Scenes.WizardScene<BotContext>(
  'buy-wizard',
  async (ctx) => {
    const setting = await prisma.setting.findUnique({
      where: { id: 1 },
      select: { enableNewPurchases: true },
    });

    if (setting && !setting.enableNewPurchases) {
      await ctx.reply('🚫 در حال حاضر خرید جدید غیرفعال است.');
      return ctx.scene.leave();
    }

    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceTomans: 'asc' },
    });

    if (plans.length === 0) {
      await ctx.reply('📭 در حال حاضر پلنی برای فروش فعال نیست.');
      return ctx.scene.leave();
    }

    const buttons = plans.map((plan) =>
      Markup.button.callback(`${plan.displayName}`, `buy_plan:${plan.id}`),
    );

    await ctx.reply('🛒 یک پلن را انتخاب کنید:', {
      reply_markup: Markup.inlineKeyboard(buttons, { columns: 1 }).reply_markup,
    });

    return ctx.wizard.next();
  },
  new Composer<BotContext>()
    .action(/^buy_plan:(.+)$/, async (ctx) => {
      const data = ctx.match[1];
      const plan = await prisma.plan.findUnique({ where: { id: data } });
      if (!plan || !plan.isActive) {
        await ctx.answerCbQuery('⚠️ پلن نامعتبر است');
        return;
      }

      const state = ctx.wizard.state as BuyWizardState;
      state.planId = plan.id;
      state.planPriceTomans = plan.priceTomans;

      await ctx.answerCbQuery();
      await ctx.reply('✍️ نام سرویس دلخواه را ارسال کنید (فقط انگلیسی/عدد، بدون فاصله):');
      return ctx.wizard.next();
    })
    .on('callback_query', async (ctx) => {
      await ctx.answerCbQuery('🔎 ابتدا یک پلن را انتخاب کنید');
    }),
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('✍️ لطفا نام سرویس را متنی ارسال کنید.');
      return;
    }

    const raw = ctx.message.text.trim();
    if (!/^[a-zA-Z0-9_-]{3,24}$/.test(raw)) {
      await ctx.reply('⚠️ نام سرویس نامعتبر است. مثال: myvpn1');
      return;
    }

    const state = ctx.wizard.state as BuyWizardState;
    state.serviceName = raw;
    await ctx.reply('🎟️ کد تخفیف (اختیاری):\nاگر ندارید "-" ارسال کنید.');

    return ctx.wizard.next();
  },
  new Composer<BotContext>()
    .on('text', async (ctx) => {
      const state = ctx.wizard.state as BuyWizardState;
      const raw = ctx.message.text.trim();
      state.promoCode = raw === '-' ? undefined : raw;

      if (!ctx.from || !state.planId || !state.serviceName) {
        await ctx.reply('⚠️ اطلاعات خرید ناقص است.');
        return ctx.scene.leave();
      }

      try {
        const plan = await prisma.plan.findUnique({
          where: { id: state.planId },
          select: { priceTomans: true, isActive: true },
        });
        if (!plan || !plan.isActive) {
          await ctx.reply('⚠️ پلن انتخابی نامعتبر است.');
          return ctx.scene.leave();
        }

        const preview = await paymentOrchestrator.createPurchasePaymentPreview({
          telegramId: ctx.from.id,
          planId: state.planId,
          serviceName: state.serviceName,
          promoCode: state.promoCode,
        });

        state.finalAmountTomans = preview.finalAmountTomans;
        state.promoCode = preview.appliedPromoCode ?? undefined;

        const setting = await prisma.setting.findUnique({
          where: { id: 1 },
          select: {
            enableTetra98: true,
            enableManualPayment: true,
          },
        });
        const tetraEnabled = setting?.enableTetra98 ?? true;
        const manualEnabled = setting?.enableManualPayment ?? true;

        if (!tetraEnabled && !manualEnabled) {
          await ctx.reply('No payment methods available');
          return ctx.scene.leave();
        }

        const paymentButtons = [
          [Markup.button.callback('💳 پرداخت از کیف پول', 'buy_gateway:wallet')],
        ];
        if (tetraEnabled) {
          paymentButtons.push([
            Markup.button.callback('🌐 پرداخت آنلاین تترا98', 'buy_gateway:tetra'),
          ]);
        }
        if (manualEnabled) {
          paymentButtons.push([
            Markup.button.callback('💳 پرداخت کارت به کارت', 'buy_gateway:manual'),
          ]);
        }

        const previewLines = [
          `💰 مبلغ اصلی: ${formatTomans(preview.originalAmountTomans)}`,
          `🎯 مبلغ پرداخت آنلاین/کیف پول: ${formatTomans(preview.finalAmountTomans)}`,
        ];
        if (manualEnabled) {
          previewLines.push('💳 مبلغ کارت به کارت پس از انتخاب این روش نمایش داده می‌شود.');
        }

        await ctx.reply(previewLines.join('\n'), {
          reply_markup: Markup.inlineKeyboard(paymentButtons).reply_markup,
        });
        return ctx.wizard.next();
      } catch (error) {
        const message =
          error instanceof AppError ? error.message : '❌ خطا در بررسی کد تخفیف. دوباره تلاش کنید.';
        await ctx.reply(message);
        return;
      }
    })
    .on('message', async (ctx) => {
      await ctx.reply('✍️ لطفا کد تخفیف را متنی ارسال کنید یا "-" بفرستید.');
    }),
  new Composer<BotContext>()
    .action(/^buy_gateway:(wallet|tetra|manual)$/, async (ctx) => {
      if (!ctx.from) {
        return;
      }

      const state = ctx.wizard.state as BuyWizardState;
      if (!state.planId || !state.serviceName) {
        await ctx.answerCbQuery('⚠️ اطلاعات خرید ناقص است');
        return ctx.scene.leave();
      }

      const gatewayMap: Record<string, PaymentGateway> = {
        wallet: PaymentGateway.WALLET,
        tetra: PaymentGateway.TETRA98,
        manual: PaymentGateway.MANUAL,
      };

      const selected = ctx.match[1];
      const gateway = gatewayMap[selected];
      const setting = await prisma.setting.findUnique({
        where: { id: 1 },
        select: {
          enableTetra98: true,
          enableManualPayment: true,
        },
      });
      const tetraEnabled = setting?.enableTetra98 ?? true;
      const manualEnabled = setting?.enableManualPayment ?? true;

      if (gateway === PaymentGateway.TETRA98 && !tetraEnabled) {
        await ctx.answerCbQuery();
        await ctx.reply('No payment methods available');
        return ctx.scene.leave();
      }

      if (gateway === PaymentGateway.MANUAL && !manualEnabled) {
        await ctx.answerCbQuery();
        await ctx.reply('No payment methods available');
        return ctx.scene.leave();
      }

      try {
        const payment = await paymentOrchestrator.createPurchasePayment({
          telegramId: ctx.from.id,
          planId: state.planId,
          serviceName: state.serviceName,
          gateway,
          promoCode: state.promoCode,
        });

        if (gateway === PaymentGateway.WALLET) {
          await ctx.answerCbQuery();
          await sendPurchaseAccessByPayment(ctx.telegram, payment.id);
          return ctx.scene.leave();
        }

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
        await ctx.replyWithMarkdownV2(
          `
          💳 لطفا دقیقا مبلغ \`${formatTomans(payment.amountTomans)}\` را به کارت
\`${cardNumber}\`
به نام *کریمی*
واریز و عکس رسید را ارسال کنید.

مبلغ واریزی را *عینا مطابق با مبلغ اعلام شده* واریز کنید و از رند کردن خودداری نمایید. از نوشتن توضیحاتی مثل خرید VPN، فیلتر شکن و ... خودداری نمایید.
در غیر اینصورت تراکنش تایید نمیگردد.
          `,
        );
        return ctx.wizard.next();
      } catch (error) {
        const message =
          error instanceof AppError
            ? error.message
            : '❌ خطا در ایجاد پرداخت. لطفا دوباره تلاش کنید.';
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
      await ctx.reply('📷 لطفا عکس رسید را ارسال کنید.');
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
          caption: `🧾 رسید جدید ثبت شد\n💳 پرداخت: ${payment.id}\n👤 کاربر: ${payment.user.telegramId.toString()}\n💰 مبلغ: ${formatTomans(payment.amountTomans)}`,
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

export const buyWizardScene = scene;
