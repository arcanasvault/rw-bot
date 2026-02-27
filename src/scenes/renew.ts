import { PaymentGateway } from '@prisma/client';
import { Composer, Markup, Scenes } from 'telegraf';
import { env } from '../config/env';
import { AppError } from '../errors/app-error';
import { prisma } from '../lib/prisma';
import { paymentOrchestrator } from '../services/payment-orchestrator';
import type { BotContext } from '../types/context';
import type { RenewWizardState } from '../types/session';
import { formatTomans } from '../utils/currency';

const scene = new Scenes.WizardScene<BotContext>(
  'renew-wizard',
  async (ctx) => {
    if (!ctx.from) {
      return ctx.scene.leave();
    }

    const sceneState = (ctx.scene.state ?? {}) as { serviceId?: string };
    if (sceneState.serviceId) {
      const preSelected = await prisma.service.findFirst({
        where: {
          id: sceneState.serviceId,
          user: { telegramId: BigInt(ctx.from.id) },
        },
        include: { plan: true },
      });

      if (!preSelected || !preSelected.plan) {
        await ctx.reply('⚠️ سرویس برای تمدید معتبر نیست.');
        return ctx.scene.leave();
      }

      const state = ctx.wizard.state as RenewWizardState;
      state.serviceId = preSelected.id;
      state.planId = preSelected.plan.id;
      state.planPriceTomans = preSelected.plan.priceTomans;

      const setting = await prisma.setting.findUnique({
        where: { id: 1 },
        select: {
          enableTetra98: true,
          enableManualPayment: true,
        },
      });
      const tetraEnabled = setting?.enableTetra98 ?? true;
      const manualEnabled = setting?.enableManualPayment ?? true;
      const paymentButtons = [
        [Markup.button.callback('💳 پرداخت از کیف پول', 'renew_gateway:wallet')],
      ];
      if (tetraEnabled) {
        paymentButtons.push([
          Markup.button.callback('🌐 پرداخت آنلاین تترا98', 'renew_gateway:tetra'),
        ]);
      }
      if (manualEnabled) {
        paymentButtons.push([
          Markup.button.callback('💳 پرداخت کارت به کارت', 'renew_gateway:manual'),
        ]);
      }

      await ctx.reply(`💰 مبلغ تمدید: ${formatTomans(state.planPriceTomans ?? 0)}`, {
        reply_markup: Markup.inlineKeyboard(paymentButtons).reply_markup,
      });
      ctx.wizard.selectStep(2);
      return;
    }

    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(ctx.from.id) },
      include: {
        services: {
          where: { isActive: true },
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user || user.services.length === 0) {
      await ctx.reply('📭 شما سرویس فعالی برای تمدید ندارید.');
      return ctx.scene.leave();
    }

    const buttons = user.services
      .filter((service) => Boolean(service.plan))
      .map((service) =>
        Markup.button.callback(
          `${service.name} | ${formatTomans(service.plan!.priceTomans)}`,
          `renew_service:${service.id}`,
        ),
      );

    if (buttons.length === 0) {
      await ctx.reply('⚠️ برای سرویس‌های تست امکان تمدید وجود ندارد.');
      return ctx.scene.leave();
    }

    await ctx.reply('🔄 سرویس مورد نظر برای تمدید را انتخاب کنید:', {
      reply_markup: Markup.inlineKeyboard(buttons, { columns: 1 }).reply_markup,
    });

    return ctx.wizard.next();
  },
  new Composer<BotContext>()
    .action(/^renew_service:(.+)$/, async (ctx) => {
      const serviceId = ctx.match[1];
      const service = await prisma.service.findUnique({
        where: { id: serviceId },
        include: { plan: true },
      });

      if (!service || !service.plan) {
        await ctx.answerCbQuery('⚠️ سرویس نامعتبر است');
        return;
      }

      const state = ctx.wizard.state as RenewWizardState;
      state.serviceId = service.id;
      state.planId = service.plan.id;
      state.planPriceTomans = service.plan.priceTomans;

      await ctx.answerCbQuery();
      const setting = await prisma.setting.findUnique({
        where: { id: 1 },
        select: {
          enableTetra98: true,
          enableManualPayment: true,
        },
      });
      const tetraEnabled = setting?.enableTetra98 ?? true;
      const manualEnabled = setting?.enableManualPayment ?? true;
      const paymentButtons = [
        [Markup.button.callback('💳 پرداخت از کیف پول', 'renew_gateway:wallet')],
      ];
      if (tetraEnabled) {
        paymentButtons.push([
          Markup.button.callback('🌐 پرداخت آنلاین تترا98', 'renew_gateway:tetra'),
        ]);
      }
      if (manualEnabled) {
        paymentButtons.push([
          Markup.button.callback('💳 پرداخت کارت به کارت', 'renew_gateway:manual'),
        ]);
      }

      await ctx.reply(`💰 مبلغ تمدید: ${formatTomans(state.planPriceTomans ?? 0)}`, {
        reply_markup: Markup.inlineKeyboard(paymentButtons).reply_markup,
      });
      return ctx.wizard.next();
    })
    .on('callback_query', async (ctx) => {
      await ctx.answerCbQuery('🔎 ابتدا سرویس را انتخاب کنید');
    }),
  new Composer<BotContext>()
    .action(/^renew_gateway:(wallet|tetra|manual)$/, async (ctx) => {
      if (!ctx.from) {
        return;
      }

      const state = ctx.wizard.state as RenewWizardState;
      if (!state.serviceId) {
        await ctx.answerCbQuery('⚠️ اطلاعات تمدید ناقص است');
        return ctx.scene.leave();
      }

      const gatewayMap: Record<string, PaymentGateway> = {
        wallet: PaymentGateway.WALLET,
        tetra: PaymentGateway.TETRA98,
        manual: PaymentGateway.MANUAL,
      };

      const gateway = gatewayMap[ctx.match[1]];
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
        const payment = await paymentOrchestrator.createRenewPayment({
          telegramId: ctx.from.id,
          serviceId: state.serviceId,
          gateway,
        });

        if (gateway === PaymentGateway.WALLET) {
          await ctx.answerCbQuery();
          await ctx.reply('✅ تمدید با موفقیت انجام شد.');
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
          caption: `🧾 رسید تمدید ثبت شد\n💳 پرداخت: ${payment.id}\n👤 کاربر: ${payment.user.telegramId.toString()}\n💰 مبلغ: ${formatTomans(payment.amountTomans)}`,
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

export const renewWizardScene = scene;
