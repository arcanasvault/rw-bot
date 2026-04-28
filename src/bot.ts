import { session, Telegraf, Scenes } from 'telegraf';
import rateLimit from 'telegraf-ratelimit';
import { env } from './config/env';
import { registerAdminCommands } from './commands/admin';
import { registerBuyCommands } from './commands/buy';
import { registerRenewCommands } from './commands/renew';
import { registerStartHandlers } from './commands/start';
import { logger } from './lib/logger';
import { ensureKnownUser } from './middlewares/auth';
import { adminAddPlanWizardScene } from './scenes/admin-add-plan';
import { adminAddPromoWizardScene } from './scenes/admin-add-promo';
import { adminEditPlanWizardScene } from './scenes/admin-edit-plan';
import { buyWizardScene } from './scenes/buy';
import { renewWizardScene } from './scenes/renew';
import { testWizardScene } from './scenes/test';
import { walletChargeWizardScene } from './scenes/wallet-charge';
import type { BotContext } from './types/context';
import type { BotSession } from './types/session';
import { fa } from './utils/farsi';

const SCENE_EXIT_TEXTS = new Set<string>([
  fa.menu.buy,
  fa.menu.myServices,
  fa.menu.test,
  fa.menu.wallet,
  fa.menu.support,
]);

function shouldAllowCallbackInScene(sceneId: string, callbackData: string): boolean {
  if (sceneId === 'buy-wizard') {
    return callbackData.startsWith('buy_plan:') || callbackData.startsWith('buy_gateway:');
  }

  if (sceneId === 'renew-wizard') {
    return callbackData.startsWith('renew_service:') || callbackData.startsWith('renew_gateway:');
  }

  if (sceneId === 'wallet-charge-wizard') {
    return callbackData.startsWith('wallet_gateway:');
  }

  return false;
}

function resetSceneSession(ctx: BotContext): void {
  if (!ctx.session || !ctx.session.__scenes) {
    return;
  }

  ctx.session.__scenes.current = undefined;
  ctx.session.__scenes.state = {};
  ctx.session.__scenes.cursor = 0;
  ctx.session.pendingManualPaymentId = undefined;
}

export function createBot(): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(env.BOT_TOKEN);

  const stage = new Scenes.Stage<BotContext>([
    adminAddPlanWizardScene,
    adminAddPromoWizardScene,
    adminEditPlanWizardScene,
    buyWizardScene,
    renewWizardScene,
    testWizardScene,
    walletChargeWizardScene,
  ]);

  bot.use(
    rateLimit({
      window: 1000,
      limit: 4,
      onLimitExceeded: (ctx) => {
        void ctx.reply('⏱️ درخواست‌های شما بیش از حد سریع است. چند ثانیه صبر کنید.');
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

  bot.use(async (ctx, next) => {
    const activeSceneId = ctx.session?.__scenes?.current;
    if (!activeSceneId) {
      await next();
      return;
    }

    if (ctx.message && 'text' in ctx.message) {
      const text = (ctx.message.text ?? '').trim();
      if (text.startsWith('/') || SCENE_EXIT_TEXTS.has(text)) {
        resetSceneSession(ctx);
      }
    }

    if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
      const callbackData = ctx.callbackQuery.data ?? '';
      if (!shouldAllowCallbackInScene(activeSceneId, callbackData)) {
        resetSceneSession(ctx);
      }
    }

    await next();
  });

  bot.use(ensureKnownUser);
  bot.use(stage.middleware());

  registerStartHandlers(bot);
  registerBuyCommands(bot);
  registerRenewCommands(bot);
  registerAdminCommands(bot);

  bot.hears(fa.menu.test, async (ctx) => {
    await ctx.scene.enter('test-wizard');
  });

  bot.action('wallet_charge', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('wallet-charge-wizard');
  });

  bot.on('callback_query', async (ctx) => {
    await ctx.answerCbQuery('⚠️ این گزینه منقضی شده یا نامعتبر است.').catch(() => undefined);
  });

  bot.catch((error) => {
    logger.error(`Bot error: ${String(error)}`);
  });

  return bot;
}
