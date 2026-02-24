import { Markup } from 'telegraf';
import type { BotContext } from '../types/context';
import { fa } from '../utils/farsi';

export function mainMenuKeyboard() {
  return Markup.keyboard([
    [fa.menu.buy, fa.menu.renew],
    [fa.menu.myServices, fa.menu.test],
    [fa.menu.wallet, fa.menu.invite],
    [fa.menu.support],
  ])
    .resize()
    .persistent();
}

export async function showMainMenu(
  ctx: BotContext,
  text = 'به ربات فروش سرویس خوش آمدید. گزینه مورد نظر را انتخاب کنید.',
): Promise<void> {
  await ctx.reply(text, {
    reply_markup: mainMenuKeyboard().reply_markup,
  });
}
