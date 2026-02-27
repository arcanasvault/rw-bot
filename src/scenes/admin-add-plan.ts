import { Scenes } from 'telegraf';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import type { BotContext } from '../types/context';
import type { AdminAddPlanWizardState } from '../types/session';

const nameSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_-]{2,60}$/);
const displayNameSchema = z.string().trim().min(2).max(100);
const positiveFloatSchema = z
  .string()
  .trim()
  .transform((value) => Number.parseFloat(value))
  .pipe(z.number().positive());
const positiveIntSchema = z
  .string()
  .trim()
  .transform((value) => Number(value))
  .pipe(z.number().int().positive());
const internalSquadSchema = z.string();

function isAdmin(ctx: BotContext): boolean {
  return Boolean(ctx.from && env.ADMIN_TG_ID_LIST.includes(ctx.from.id));
}

const scene = new Scenes.WizardScene<BotContext>(
  'admin-add-plan-wizard',
  async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply('🔐 این دستور فقط برای ادمین است.');
      return ctx.scene.leave();
    }

    await ctx.reply('🧩 نام سیستمی پلن را وارد کنید (فقط انگلیسی/عدد/خط تیره):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('⚠️ متن معتبر ارسال کنید.');
      return;
    }

    const parsed = nameSchema.safeParse(ctx.message.text);
    if (!parsed.success) {
      await ctx.reply('⚠️ نام پلن نامعتبر است. مثال: gold-plan');
      return;
    }

    const state = ctx.wizard.state as AdminAddPlanWizardState;
    state.name = parsed.data;
    await ctx.reply('📝 displayName پلن برای کاربر را وارد کنید (مثال: پلن طلایی):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('⚠️ متن معتبر ارسال کنید.');
      return;
    }

    const parsed = displayNameSchema.safeParse(ctx.message.text);
    if (!parsed.success) {
      await ctx.reply('⚠️ displayName نامعتبر است.');
      return;
    }

    const state = ctx.wizard.state as AdminAddPlanWizardState;
    state.displayName = parsed.data;
    await ctx.reply('🌐 مقدار trafficGb را وارد کنید (عدد اعشاری مجاز است):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('🔢 عدد معتبر ارسال کنید.');
      return;
    }

    const parsed = positiveFloatSchema.safeParse(ctx.message.text);
    if (!parsed.success) {
      await ctx.reply('⚠️ trafficGb باید عدد مثبت باشد.');
      return;
    }

    const state = ctx.wizard.state as AdminAddPlanWizardState;
    state.trafficGb = parsed.data;
    await ctx.reply('🗓 مقدار durationDays را وارد کنید (عدد اعشاری مجاز است):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('🔢 عدد معتبر ارسال کنید.');
      return;
    }

    const parsed = positiveFloatSchema.safeParse(ctx.message.text);
    if (!parsed.success) {
      await ctx.reply('⚠️ durationDays باید عدد مثبت باشد.');
      return;
    }

    const state = ctx.wizard.state as AdminAddPlanWizardState;
    state.durationDays = parsed.data;
    await ctx.reply('💰 priceTomans را وارد کنید (عدد صحیح):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('🔢 عدد معتبر ارسال کنید.');
      return;
    }

    const parsed = positiveIntSchema.safeParse(ctx.message.text);
    if (!parsed.success) {
      await ctx.reply('⚠️ priceTomans باید عدد صحیح مثبت باشد.');
      return;
    }

    const state = ctx.wizard.state as AdminAddPlanWizardState;
    state.priceTomans = parsed.data;
    await ctx.reply('Enter internal squad ID(s) for this plan (comma-separated if multiple):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('⚠️ مقدار معتبر ارسال کنید.');
      return;
    }

    const parsed = internalSquadSchema.safeParse(ctx.message.text.replace(/\s+/g, ''));
    if (!parsed.success) {
      await ctx.reply('⚠️ internalSquadId نامعتبر است. مثال: 1,2,3');
      return;
    }

    const state = ctx.wizard.state as AdminAddPlanWizardState;
    state.internalSquadId = parsed.data;

    if (
      !state.name ||
      !state.displayName ||
      !state.trafficGb ||
      !state.durationDays ||
      !state.priceTomans ||
      !state.internalSquadId
    ) {
      await ctx.reply('⚠️ اطلاعات پلن ناقص است.');
      return ctx.scene.leave();
    }

    try {
      await prisma.plan.create({
        data: {
          name: state.name,
          displayName: state.displayName,
          trafficGb: state.trafficGb,
          durationDays: state.durationDays,
          priceTomans: state.priceTomans,
          internalSquadId: state.internalSquadId,
          isActive: true,
        },
      });

      await ctx.reply('✅ پلن با موفقیت ایجاد شد.');
    } catch {
      await ctx.reply('❌ ایجاد پلن ناموفق بود. ممکن است name یا ترکیب پلن تکراری باشد.');
    }

    return ctx.scene.leave();
  },
);

export const adminAddPlanWizardScene = scene;
