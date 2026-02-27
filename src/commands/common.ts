import { Markup } from 'telegraf';
import type { BotContext } from '../types/context';
import { fa } from '../utils/farsi';

export function mainMenuKeyboard() {
  return Markup.keyboard([
    [fa.menu.buy, fa.menu.myServices],
    [fa.menu.wallet, fa.menu.test],
    [fa.menu.support],
  ])
    .resize()
    .persistent();
}

export async function showMainMenu(
  ctx: BotContext,
  text = `🚀 سلام 👋 به ربات آرکانا خوش آمدید.

یادتون نره توی کانال @arcanair عوض بشید.

🎁 تست رایگان بگیرید و در صورت رضایت، در عرض 30 ثانیه سرویس خودتون رو بخرید 👇`,
): Promise<void> {
  await ctx.reply(text, {
    reply_markup: mainMenuKeyboard().reply_markup,
  });
}
