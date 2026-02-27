import { PaymentType } from '@prisma/client';
import type { Telegram } from 'telegraf';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { remnawaveService } from './remnawave';
import { bytesToGb, daysLeft } from '../utils/format';
import { generateQrPngBuffer } from './qr-generator';

function parseServiceName(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const value = (payload as Record<string, unknown>).serviceName;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseSubscriptionUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const data = payload as Record<string, unknown>;
  const direct =
    (typeof data.subscriptionUrl === 'string' && data.subscriptionUrl) ||
    (typeof data.subscription_url === 'string' && data.subscription_url) ||
    (typeof data.url === 'string' && data.url) ||
    (typeof data.link === 'string' && data.link);

  if (direct && direct.trim().length > 0) {
    return direct.trim();
  }

  return null;
}

export async function sendPurchaseAccessByPayment(
  telegram: Telegram,
  paymentId: string,
): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { user: true },
  });
  if (!payment || payment.type !== PaymentType.PURCHASE) {
    return;
  }

  const serviceName = parseServiceName(payment.callbackPayload);
  const service = await prisma.service.findFirst({
    where: {
      userId: payment.userId,
      isTest: false,
      ...(serviceName ? { name: serviceName } : {}),
    },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!service) {
    await telegram.sendMessage(
      Number(payment.user.telegramId),
      '✅ پرداخت شما با موفقیت تایید شد. برای دریافت کانفیگ از «سرویس‌های من» استفاده کنید.',
    );
    return;
  }

  let subscriptionUrl = service.subscriptionUrl ?? '';
  try {
    const remoteSub = await remnawaveService.getSubscriptionByUuid(service.remnaUserUuid);
    subscriptionUrl = parseSubscriptionUrl(remoteSub) ?? subscriptionUrl;

    if (subscriptionUrl && subscriptionUrl !== service.subscriptionUrl) {
      await prisma.service.update({
        where: { id: service.id },
        data: { subscriptionUrl },
      });
    }
  } catch (error) {
    logger.warn(
      `purchase delivery remote sub fetch failed service=${service.id} error=${String(error)}`,
    );
  }

  await telegram.sendMessage(
    Number(payment.user.telegramId),
    `🎉 سرویس شما با موفقیت خریداری شد.\n🔮 نام سرویس: ${service.name}`,
  );

  if (!subscriptionUrl) {
    await telegram.sendMessage(
      Number(payment.user.telegramId),
      '⚠️ لینک اشتراک فعلا در دسترس نیست. از بخش «سرویس‌های من» دوباره بررسی کنید.',
    );
    return;
  }

  try {
    const qrBuffer = await generateQrPngBuffer({
      data: subscriptionUrl,
      telegramId: Number(payment.user.telegramId),
    });

    const serviceTrafficInGb = Math.floor(bytesToGb(service.trafficLimitBytes));
    const serviceDays =
      service.plan?.durationDays ?? Math.max(0, daysLeft(service.expireAt));

    const serviceDetailsCaption = [
      '📱 کد QR اشتراک شما',
      `🔮 سرویس: ${service.name}`,
      `🌐 حجم: ${serviceTrafficInGb} گیگابایت`,
      `🗓 مدت: ${serviceDays} روز`,
      `🔗 لینک اشتراک: ${subscriptionUrl}`,
    ].join('\n');

    await telegram.sendPhoto(
      Number(payment.user.telegramId),
      { source: qrBuffer },
      {
        caption: serviceDetailsCaption,
      },
    );
  } catch (error) {
    logger.error(`Failed to generate QR for user ${payment.user.telegramId.toString()}: ${String(error)}`);
  }
}
