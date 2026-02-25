import { Scenes } from 'telegraf';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import type { BotContext } from '../types/context';
import type { AdminEditPlanWizardState } from '../types/session';

const planIdSchema = z.string().trim().min(8);
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
const internalSquadSchema = z
  .string()
  .trim()
  .regex(/^\d+(,\d+)*$/);

function isAdmin(ctx: BotContext): boolean {
  return Boolean(ctx.from && env.ADMIN_TG_ID_LIST.includes(ctx.from.id));
}

const scene = new Scenes.WizardScene<BotContext>(
  'admin-edit-plan-wizard',
  async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply('این دستور فقط برای ادمین است.');
      return ctx.scene.leave();
    }

    const plans = await prisma.plan.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    if (!plans.length) {
      await ctx.reply('پلنی برای ویرایش وجود ندارد.');
      return ctx.scene.leave();
    }

    await ctx.reply(
      [
        'لیست پلن ها:',
        ...plans.map((plan) => `${plan.id} | ${plan.displayName} (${plan.name})`),
        '',
        'ID پلن مورد نظر را ارسال کنید:',
      ].join('\n'),
    );

    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('ID پلن را متنی ارسال کنید.');
      return;
    }

    const parsedId = planIdSchema.safeParse(ctx.message.text);
    if (!parsedId.success) {
      await ctx.reply('ID نامعتبر است.');
      return;
    }

    const plan = await prisma.plan.findUnique({
      where: { id: parsedId.data },
    });
    if (!plan) {
      await ctx.reply('پلن پیدا نشد. دوباره ID را وارد کنید.');
      return;
    }

    const state = ctx.wizard.state as AdminEditPlanWizardState;
    state.planId = plan.id;

    await ctx.reply(`نام سیستمی جدید را وارد کنید (فعلی: ${plan.name}):`);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('متن معتبر ارسال کنید.');
      return;
    }

    const parsed = nameSchema.safeParse(ctx.message.text);
    if (!parsed.success) {
      await ctx.reply('نام پلن نامعتبر است.');
      return;
    }

    const state = ctx.wizard.state as AdminEditPlanWizardState;
    state.name = parsed.data;
    await ctx.reply('displayName جدید را وارد کنید:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('متن معتبر ارسال کنید.');
      return;
    }

    const parsed = displayNameSchema.safeParse(ctx.message.text);
    if (!parsed.success) {
      await ctx.reply('displayName نامعتبر است.');
      return;
    }

    const state = ctx.wizard.state as AdminEditPlanWizardState;
    state.displayName = parsed.data;
    await ctx.reply('trafficGb جدید را وارد کنید:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('عدد معتبر ارسال کنید.');
      return;
    }

    const parsed = positiveFloatSchema.safeParse(ctx.message.text);
    if (!parsed.success) {
      await ctx.reply('trafficGb باید عدد مثبت باشد.');
      return;
    }

    const state = ctx.wizard.state as AdminEditPlanWizardState;
    state.trafficGb = parsed.data;
    await ctx.reply('durationDays جدید را وارد کنید:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('عدد معتبر ارسال کنید.');
      return;
    }

    const parsed = positiveFloatSchema.safeParse(ctx.message.text);
    if (!parsed.success) {
      await ctx.reply('durationDays باید عدد مثبت باشد.');
      return;
    }

    const state = ctx.wizard.state as AdminEditPlanWizardState;
    state.durationDays = parsed.data;
    await ctx.reply('priceTomans جدید را وارد کنید:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('عدد معتبر ارسال کنید.');
      return;
    }

    const parsed = positiveIntSchema.safeParse(ctx.message.text);
    if (!parsed.success) {
      await ctx.reply('priceTomans باید عدد صحیح مثبت باشد.');
      return;
    }

    const state = ctx.wizard.state as AdminEditPlanWizardState;
    state.priceTomans = parsed.data;
    await ctx.reply('Enter internal squad ID(s) for this plan (comma-separated if multiple):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('مقدار معتبر ارسال کنید.');
      return;
    }

    const parsed = internalSquadSchema.safeParse(ctx.message.text.replace(/\s+/g, ''));
    if (!parsed.success) {
      await ctx.reply('internalSquadId نامعتبر است. مثال: 1,2,3');
      return;
    }

    const state = ctx.wizard.state as AdminEditPlanWizardState;
    state.internalSquadId = parsed.data;

    if (
      !state.planId ||
      !state.name ||
      !state.displayName ||
      !state.trafficGb ||
      !state.durationDays ||
      !state.priceTomans ||
      !state.internalSquadId
    ) {
      await ctx.reply('اطلاعات ویرایش ناقص است.');
      return ctx.scene.leave();
    }

    try {
      await prisma.plan.update({
        where: { id: state.planId },
        data: {
          name: state.name,
          displayName: state.displayName,
          trafficGb: state.trafficGb,
          durationDays: state.durationDays,
          priceTomans: state.priceTomans,
          internalSquadId: state.internalSquadId,
        },
      });
      await ctx.reply('پلن با موفقیت ویرایش شد.');
    } catch {
      await ctx.reply('ویرایش پلن ناموفق بود.');
    }

    return ctx.scene.leave();
  },
);

export const adminEditPlanWizardScene = scene;
