import { session, Telegraf, Scenes } from 'telegraf';
import rateLimit from 'telegraf-ratelimit';
import { env } from './config/env';
import { registerAdminCommands } from './commands/admin';
import { registerBuyCommands } from './commands/buy';
import { registerRenewCommands } from './commands/renew';
import { registerStartHandlers } from './commands/start';
import { AppError } from './errors/app-error';
import { logger } from './lib/logger';
import { ensureKnownUser } from './middlewares/auth';
import { buyWizardScene } from './scenes/buy';
import { renewWizardScene } from './scenes/renew';
import { walletChargeWizardScene } from './scenes/wallet-charge';
import type { BotContext } from './types/context';
import type { BotSession } from './types/session';
import { fa } from './utils/farsi';
import { paymentOrchestrator } from './services/payment-orchestrator';

export function createBot(): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(env.BOT_TOKEN);

  const stage = new Scenes.Stage<BotContext>([
    buyWizardScene,
    renewWizardScene,
    walletChargeWizardScene,
  ]);

  bot.use(
    rateLimit({
      window: 3000,
      limit: 1,
      onLimitExceeded: (ctx) => {
        void ctx.reply('درخواست های شما بیش از حد سریع است. چند ثانیه صبر کنید.');
      },
    }),
  );

  bot.use(
    session({
      defaultSession: (): BotSession => ({
        __scenes: {
          cursor: 0,
        },
      }),
    }),
  );

  bot.use(ensureKnownUser);
  bot.use(stage.middleware());

  registerStartHandlers(bot);
  registerBuyCommands(bot);
  registerRenewCommands(bot);
  registerAdminCommands(bot);

  bot.hears(fa.menu.test, async (ctx) => {
    if (!ctx.from) {
      return;
    }

    try {
      const result = await paymentOrchestrator.createTestSubscription(ctx.from.id);
      await ctx.reply(
        `سرویس تست با نام ${result.serviceName} فعال شد.\nلینک اشتراک:\n${result.subscriptionUrl}`,
      );
    } catch (error) {
      if (error instanceof AppError && error.code === 'TEST_DISABLED') {
        await ctx.reply('در حال حاضر سرویس تست ارائه نمی‌شود');
        return;
      }

      const message = error instanceof AppError ? error.message : 'خطا در ایجاد سرویس تست';
      await ctx.reply(message);
    }
  });

  bot.action('wallet_charge', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('wallet-charge-wizard');
  });

  bot.catch((error) => {
    logger.error(`Bot error: ${String(error)}`);
  });

  return bot;
}
