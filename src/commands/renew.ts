import { Telegraf } from 'telegraf';
import type { BotContext } from '../types/context';

export function registerRenewCommands(bot: Telegraf<BotContext>): void {
  bot.command('renew', async (ctx) => {
    await ctx.scene.enter('renew-wizard');
  });
}
