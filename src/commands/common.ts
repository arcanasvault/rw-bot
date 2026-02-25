import { Markup } from 'telegraf';
import type { BotContext } from '../types/context';
import { fa } from '../utils/farsi';

export function expandedMainMenuKeyboard() {
  return Markup.keyboard([
    [fa.menu.buy, fa.menu.renew],
    [fa.menu.myServices, fa.menu.test],
    [fa.menu.wallet, fa.menu.support],
    [fa.menu.collapse],
  ])
    .resize()
    .persistent();
}

export function collapsedMainMenuKeyboard() {
  return Markup.keyboard([[fa.menu.expand], [fa.menu.support]])
    .resize()
    .persistent();
}

export async function showMainMenu(
  ctx: BotContext,
  text = 'به ربات فروش سرویس خوش آمدید. گزینه مورد نظر را انتخاب کنید.',
  collapsed = false,
): Promise<void> {
  await ctx.reply(text, {
    reply_markup: (collapsed ? collapsedMainMenuKeyboard() : expandedMainMenuKeyboard())
      .reply_markup,
  });
}
