import { Telegraf } from 'telegraf';
import { prisma } from '../lib/prisma';
import type { BotContext } from '../types/context';
import { fa } from '../utils/farsi';

export function registerBuyCommands(bot: Telegraf<BotContext>): void {
  bot.hears(fa.menu.buy, async (ctx) => {
    const setting = await prisma.setting.findUnique({
      where: { id: 1 },
      select: { enableNewPurchases: true },
    });
    if (setting && !setting.enableNewPurchases) {
      await ctx.reply('🚫 در حال حاضر خرید جدید غیرفعال است.');
      return;
    }

    await ctx.scene.enter('buy-wizard');
  });

  bot.command('buy', async (ctx) => {
    const setting = await prisma.setting.findUnique({
      where: { id: 1 },
      select: { enableNewPurchases: true },
    });
    if (setting && !setting.enableNewPurchases) {
      await ctx.reply('🚫 در حال حاضر خرید جدید غیرفعال است.');
      return;
    }

    await ctx.scene.enter('buy-wizard');
  });
}
