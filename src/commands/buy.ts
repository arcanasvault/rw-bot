import { Telegraf } from 'telegraf';
import type { BotContext } from '../types/context';
import { fa } from '../utils/farsi';

export function registerBuyCommands(bot: Telegraf<BotContext>): void {
  bot.hears(fa.menu.buy, async (ctx) => {
    await ctx.scene.enter('buy-wizard');
  });

  bot.command('buy', async (ctx) => {
    await ctx.scene.enter('buy-wizard');
  });
}
