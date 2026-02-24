import { Telegraf } from 'telegraf';
import type { BotContext } from '../types/context';
import { fa } from '../utils/farsi';

export function registerRenewCommands(bot: Telegraf<BotContext>): void {
  bot.hears(fa.menu.renew, async (ctx) => {
    await ctx.scene.enter('renew-wizard');
  });

  bot.command('renew', async (ctx) => {
    await ctx.scene.enter('renew-wizard');
  });
}
