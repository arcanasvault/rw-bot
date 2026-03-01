import { PromoType } from '@prisma/client';
import { Scenes } from 'telegraf';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import type { BotContext } from '../types/context';
import type { AdminAddPromoWizardState } from '../types/session';

const codeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9_-]{3,40}$/));

const typeSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .pipe(z.enum(['percent', 'fixed']));

const positiveIntSchema = z
  .string()
  .trim()
  .transform((value) => Number(value))
  .pipe(z.number().int().positive());

function isAdmin(ctx: BotContext): boolean {
  return Boolean(ctx.from && env.ADMIN_TG_ID_LIST.includes(ctx.from.id));
}

const scene = new Scenes.WizardScene<BotContext>(
  'admin-add-promo-wizard',
  async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply('🔐 این دستور فقط برای ادمین است.');
      return ctx.scene.leave();
    }

    await ctx.reply('🎟️ کد تخفیف را وارد کنید (مثال: 50OFF):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('⚠️ متن معتبر ارسال کنید.');
      return;
    }

    const parsed = codeSchema.safeParse(ctx.message.text);
    if (!parsed.success) {
      await ctx.reply('⚠️ کد نامعتبر است. فقط حروف انگلیسی/عدد/خط تیره/زیرخط.');
      return;
    }

    const state = ctx.wizard.state as AdminAddPromoWizardState;
    state.code = parsed.data;
    await ctx.reply('🧮 نوع تخفیف را وارد کنید: percent یا fixed');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('⚠️ متن معتبر ارسال کنید.');
      return;
    }

    const parsed = typeSchema.safeParse(ctx.message.text);
    if (!parsed.success) {
      await ctx.reply('⚠️ نوع نامعتبر است. فقط percent یا fixed.');
      return;
    }

    const state = ctx.wizard.state as AdminAddPromoWizardState;
    state.type = parsed.data === 'percent' ? 'PERCENT' : 'FIXED';
    await ctx.reply(
      state.type === 'PERCENT'
        ? '🔢 مقدار درصد تخفیف را وارد کنید (1 تا 100):'
        : '🔢 مبلغ ثابت تخفیف را به تومان وارد کنید (عدد صحیح مثبت):',
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('🔢 عدد معتبر ارسال کنید.');
      return;
    }

    const parsed = positiveIntSchema.safeParse(ctx.message.text);
    if (!parsed.success) {
      await ctx.reply('⚠️ مقدار باید عدد صحیح مثبت باشد.');
      return;
    }

    const state = ctx.wizard.state as AdminAddPromoWizardState;
    if (state.type === 'PERCENT' && parsed.data > 100) {
      await ctx.reply('⚠️ درصد تخفیف باید حداکثر 100 باشد.');
      return;
    }

    state.value = parsed.data;
    await ctx.reply('🔁 حداکثر تعداد استفاده (maxUses) را وارد کنید:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('🔢 عدد معتبر ارسال کنید.');
      return;
    }

    const parsed = positiveIntSchema.safeParse(ctx.message.text);
    if (!parsed.success) {
      await ctx.reply('⚠️ maxUses باید عدد صحیح مثبت باشد.');
      return;
    }

    const state = ctx.wizard.state as AdminAddPromoWizardState;
    state.maxUses = parsed.data;
    await ctx.reply('📅 تاریخ انقضا (اختیاری) را به فرمت YYYY-MM-DD وارد کنید یا "-" بفرستید:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('⚠️ متن معتبر ارسال کنید.');
      return;
    }

    const state = ctx.wizard.state as AdminAddPromoWizardState;
    const raw = ctx.message.text.trim();

    let expiresAt: Date | null = null;
    if (raw !== '-') {
      const parsedDate = new Date(raw);
      if (Number.isNaN(parsedDate.getTime())) {
        await ctx.reply('⚠️ فرمت تاریخ نامعتبر است. مثال: 2026-12-31 یا -');
        return;
      }
      expiresAt = parsedDate;
    }

    state.expiresAt = expiresAt;

    if (!state.code || !state.type || !state.value || !state.maxUses) {
      await ctx.reply('⚠️ اطلاعات کد تخفیف ناقص است.');
      return ctx.scene.leave();
    }

    try {
      await prisma.promo.create({
        data: {
          code: state.code,
          type: state.type as PromoType,
          value: state.value,
          maxUses: state.maxUses,
          currentUses: 0,
          expiresAt: state.expiresAt,
          isActive: true,
        },
      });

      await ctx.reply('✅ کد تخفیف ثبت شد.');
    } catch {
      await ctx.reply('❌ ثبت کد تخفیف ناموفق بود. ممکن است کد تکراری باشد.');
    }

    return ctx.scene.leave();
  },
);

export const adminAddPromoWizardScene = scene;
