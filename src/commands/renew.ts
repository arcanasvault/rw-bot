import { Telegraf } from 'telegraf';
import { prisma } from '../lib/prisma';
import type { BotContext } from '../types/context';

export function registerRenewCommands(bot: Telegraf<BotContext>): void {
  bot.command('renew', async (ctx) => {
    const setting = await prisma.setting.findUnique({
      where: { id: 1 },
      select: { enableRenewals: true },
    });
    if (setting && !setting.enableRenewals) {
      await ctx.reply('🚫 در حال حاضر تمدید غیرفعال است.');
      return;
    }

    await ctx.scene.enter('renew-wizard');
  });
}
