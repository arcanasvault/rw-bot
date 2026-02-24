import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseAdminIds(raw: string | undefined): bigint[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => BigInt(item));
}

async function main(): Promise<void> {
  const adminIds = parseAdminIds(process.env.ADMIN_TG_IDS);

  await prisma.setting.upsert({
    where: { id: 1 },
    update: {
      manualCardNumber: process.env.MANUAL_CARD_NUMBER ?? null,
      supportHandle: process.env.ADMIN_TG_HANDLE ?? null,
    },
    create: {
      id: 1,
      testEnabled: true,
      testTrafficBytes: BigInt(5 * 1024 * 1024 * 1024),
      testDurationDays: 1,
      notifyDaysLeft: 3,
      notifyGbLeft: 2,
      affiliateRewardType: 'FIXED',
      affiliateRewardValue: 15000,
      manualCardNumber: process.env.MANUAL_CARD_NUMBER ?? null,
      supportHandle: process.env.ADMIN_TG_HANDLE ?? null,
    },
  });

  const defaultPlans = [
    { name: 'اقتصادی', trafficGb: 50, durationDays: 30, priceTomans: 70000 },
    { name: 'حرفه ای', trafficGb: 120, durationDays: 30, priceTomans: 130000 },
    { name: 'نامحدود یک ماهه', trafficGb: 300, durationDays: 30, priceTomans: 220000 },
  ];

  for (const plan of defaultPlans) {
    await prisma.plan.upsert({
      where: {
        name_trafficGb_durationDays: {
          name: plan.name,
          trafficGb: plan.trafficGb,
          durationDays: plan.durationDays,
        },
      },
      update: {
        priceTomans: plan.priceTomans,
        isActive: true,
      },
      create: plan,
    });
  }

  for (const tgId of adminIds) {
    await prisma.user.upsert({
      where: { telegramId: tgId },
      update: {},
      create: {
        telegramId: tgId,
        firstName: 'Admin',
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('Seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
