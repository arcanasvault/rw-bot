import { Scenes } from 'telegraf';
import { AppError } from '../errors/app-error';
import { prisma } from '../lib/prisma';
import { paymentOrchestrator } from '../services/payment-orchestrator';
import { sendServiceAccessByServiceId } from '../services/purchase-delivery';
import { remnawaveService } from '../services/remnawave';
import type { BotContext } from '../types/context';
import type { TestWizardState } from '../types/session';

const scene = new Scenes.WizardScene<BotContext>(
  'test-wizard',
  async (ctx) => {
    await ctx.reply('✍️ نام سرویس دلخواه را ارسال کنید (فقط انگلیسی/عدد، بدون فاصله):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message) || !ctx.from) {
      await ctx.reply('✍️ لطفا نام سرویس را متنی ارسال کنید.');
      return;
    }

    const raw = ctx.message.text.trim();
    if (!/^[a-zA-Z0-9_-]{3,24}$/.test(raw)) {
      await ctx.reply('⚠️ نام سرویس نامعتبر است. مثال: myvpn1');
      return;
    }

    try {
      if (await remnawaveService.usernameExists(raw)) {
        await ctx.reply('این نام کاربری قبلاً گرفته شده است. لطفاً نام دیگری وارد کنید.');
        return;
      }
    } catch {
      await ctx.reply('❌ خطا در بررسی نام کاربری. لطفا دوباره تلاش کنید.');
      return;
    }

    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(ctx.from.id) },
      select: { id: true },
    });

    if (user) {
      const duplicate = await prisma.service.findFirst({
        where: {
          userId: user.id,
          name: raw,
        },
        select: { id: true },
      });

      if (duplicate) {
        await ctx.reply('سرویسی با این نام قبلا ثبت شده است');
        return;
      }
    }

    const state = ctx.wizard.state as TestWizardState;
    state.serviceName = raw;

    try {
      const result = await paymentOrchestrator.createTestSubscription(ctx.from.id, state.serviceName);
      await sendServiceAccessByServiceId(ctx.telegram, ctx.from.id, result.serviceId, {
        successPrefix: '🎁 سرویس تست شما با موفقیت فعال شد.',
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'TEST_DISABLED') {
        await ctx.reply('🚫 در حال حاضر سرویس تست ارائه نمی‌شود');
        return ctx.scene.leave();
      }

      const message = error instanceof AppError ? error.message : '❌ خطا در ایجاد سرویس تست';
      await ctx.reply(message);
    }

    return ctx.scene.leave();
  },
);

export const testWizardScene = scene;
