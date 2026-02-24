import {
  AffiliateRewardType,
  Payment,
  PaymentGateway,
  PaymentStatus,
  PaymentType,
  Prisma,
  WalletTransactionType,
} from '@prisma/client';
import { env } from '../config/env';
import { AppError } from '../errors/app-error';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { toRials } from '../utils/currency';
import { sanitizeServiceName } from '../utils/format';
import { remnawaveService } from './remnawave';
import { tetra98Service } from './tetra98';
import { walletService } from './wallet';

interface DiscountResult {
  finalAmountTomans: number;
  promoCodeId: string | null;
}

async function findOrCreateUserByTelegramId(telegramId: number) {
  return prisma.user.upsert({
    where: { telegramId: BigInt(telegramId) },
    update: {},
    create: { telegramId: BigInt(telegramId) },
  });
}

async function computeDiscount(input: {
  amountTomans: number;
  promoCode?: string;
}): Promise<DiscountResult> {
  if (!input.promoCode) {
    return { finalAmountTomans: input.amountTomans, promoCodeId: null };
  }

  const normalized = input.promoCode.trim().toUpperCase();

  const promo = await prisma.promoCode.findUnique({
    where: { code: normalized },
  });

  if (!promo || !promo.isActive || promo.usesLeft <= 0) {
    throw new AppError('کد تخفیف معتبر نیست', 'PROMO_INVALID', 400);
  }

  if (promo.expiresAt && promo.expiresAt.getTime() < Date.now()) {
    throw new AppError('کد تخفیف منقضی شده است', 'PROMO_EXPIRED', 400);
  }

  let final = input.amountTomans;

  if (promo.discountPercent && promo.discountPercent > 0) {
    final -= Math.floor((input.amountTomans * promo.discountPercent) / 100);
  }

  if (promo.fixedTomans && promo.fixedTomans > 0) {
    final -= promo.fixedTomans;
  }

  final = Math.max(0, final);

  return { finalAmountTomans: final, promoCodeId: promo.id };
}

async function markPromoUsage(payment: Payment): Promise<void> {
  if (!payment.promoCodeId) {
    return;
  }

  const existing = await prisma.promoUsage.findUnique({
    where: { paymentId: payment.id },
  });

  if (existing) {
    return;
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const promo = await tx.promoCode.findUnique({ where: { id: payment.promoCodeId! } });
    if (!promo || promo.usesLeft <= 0) {
      throw new AppError('استفاده از کد تخفیف ممکن نیست', 'PROMO_USE_FAILED', 400);
    }

    await tx.promoCode.update({
      where: { id: payment.promoCodeId! },
      data: {
        usesLeft: { decrement: 1 },
      },
    });

    await tx.promoUsage.create({
      data: {
        promoCodeId: payment.promoCodeId!,
        userId: payment.userId,
        paymentId: payment.id,
      },
    });
  });
}

async function rewardAffiliateIfNeeded(payment: Payment): Promise<void> {
  if (payment.type !== PaymentType.PURCHASE) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: payment.userId },
    include: { referredBy: true },
  });

  if (!user || !user.referredById || user.affiliateRewardProcessed) {
    return;
  }

  const setting = await prisma.setting.findUnique({ where: { id: 1 } });
  const rewardType = setting?.affiliateRewardType ?? AffiliateRewardType.FIXED;
  const rewardValue = setting?.affiliateRewardValue ?? 0;

  const rewardTomans =
    rewardType === AffiliateRewardType.PERCENT
      ? Math.floor((payment.amountTomans * rewardValue) / 100)
      : rewardValue;

  if (rewardTomans > 0) {
    await walletService.credit({
      userId: user.referredById,
      amountTomans: rewardTomans,
      type: WalletTransactionType.AFFILIATE_REWARD,
      description: `پاداش همکاری فروش از خرید کاربر ${user.telegramId.toString()}`,
      paymentId: payment.id,
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      affiliateRewardProcessed: true,
      firstPurchaseAt: new Date(),
    },
  });
}

function calculateBytes(trafficGb: number): number {
  return trafficGb * 1024 * 1024 * 1024;
}

function ensureServiceName(name: string): string {
  const trimmed = name.trim();

  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(trimmed)) {
    throw new AppError('نام سرویس نامعتبر است', 'SERVICE_NAME_INVALID', 400);
  }

  return trimmed;
}

function readServiceNameFromPayload(payload: Prisma.JsonValue | null): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError('اطلاعات پرداخت ناقص است', 'PAYLOAD_INVALID', 400);
  }

  const payloadObject = payload as Prisma.JsonObject;
  const maybeServiceName = payloadObject.serviceName;
  if (typeof maybeServiceName !== 'string') {
    throw new AppError('نام سرویس نامعتبر است', 'SERVICE_NAME_INVALID', 400);
  }

  return ensureServiceName(maybeServiceName);
}

function buildUniqueRemnaUsername(telegramId: bigint, serviceName: string): string {
  const slug = sanitizeServiceName(serviceName);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `tg_${telegramId.toString()}-${slug}-${suffix}`;
}

async function completePurchase(payment: Payment): Promise<void> {
  if (!payment.planId) {
    throw new AppError('پلن برای خرید مشخص نیست', 'PLAN_REQUIRED', 400);
  }

  const [user, plan] = await Promise.all([
    prisma.user.findUnique({ where: { id: payment.userId } }),
    prisma.plan.findUnique({ where: { id: payment.planId } }),
  ]);

  if (!user || !plan) {
    throw new AppError('اطلاعات خرید ناقص است', 'PAYMENT_DATA_INVALID', 400);
  }

  const serviceName = readServiceNameFromPayload(payment.callbackPayload);
  const duplicate = await prisma.service.findFirst({
    where: {
      userId: user.id,
      name: serviceName,
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new AppError('سرویسی با این نام قبلا ثبت شده است', 'SERVICE_NAME_DUPLICATE', 409);
  }

  const trafficLimitBytes = calculateBytes(plan.trafficGb);
  const expireAt = new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000);
  const remnaUsername = buildUniqueRemnaUsername(user.telegramId, serviceName);

  const created = await remnawaveService.createUser({
    username: remnaUsername,
    trafficLimitBytes,
    expireAt,
    telegramId: Number(user.telegramId),
  });

  try {
    const subscription = await remnawaveService
      .getSubscriptionByUuid(created.uuid)
      .catch(() => null);

    await prisma.service.create({
      data: {
        userId: user.id,
        planId: plan.id,
        name: serviceName,
        remnaUsername,
        remnaUserUuid: created.uuid,
        shortUuid: created.shortUuid ?? null,
        subscriptionUrl: created.subscriptionUrl ?? subscription?.subscriptionUrl ?? null,
        trafficLimitBytes: BigInt(trafficLimitBytes),
        expireAt,
        lastKnownUsedBytes: BigInt(0),
        isActive: true,
      },
    });
  } catch (error) {
    await remnawaveService.deleteUser(created.uuid).catch(() => undefined);
    throw error;
  }
}

async function completeRenewal(payment: Payment): Promise<void> {
  if (!payment.targetServiceId) {
    throw new AppError('سرویس تمدید مشخص نیست', 'SERVICE_REQUIRED', 400);
  }

  const service = await prisma.service.findUnique({
    where: { id: payment.targetServiceId },
    include: { plan: true },
  });

  if (!service || !service.plan) {
    throw new AppError('سرویس یا پلن پیدا نشد', 'SERVICE_NOT_FOUND', 404);
  }

  const now = new Date();
  const base = service.expireAt > now ? service.expireAt : now;
  const newExpireAt = new Date(base.getTime() + service.plan.durationDays * 24 * 60 * 60 * 1000);
  const newLimitBytes = calculateBytes(service.plan.trafficGb);

  await remnawaveService.updateUser({
    uuid: service.remnaUserUuid,
    trafficLimitBytes: newLimitBytes,
    expireAt: newExpireAt,
    enabled: true,
  });

  await remnawaveService.resetTraffic(service.remnaUserUuid);

  await prisma.service.update({
    where: { id: service.id },
    data: {
      trafficLimitBytes: BigInt(newLimitBytes),
      expireAt: newExpireAt,
      lastKnownUsedBytes: BigInt(0),
      isActive: true,
    },
  });
}

export class PaymentOrchestrator {
  async createWalletChargePayment(input: {
    telegramId: number;
    amountTomans: number;
    gateway: PaymentGateway;
  }) {
    if (!Number.isInteger(input.amountTomans) || input.amountTomans <= 0) {
      throw new AppError('مبلغ شارژ نامعتبر است', 'INVALID_AMOUNT', 400);
    }

    if (
      input.amountTomans < env.MIN_WALLET_CHARGE_TOMANS ||
      input.amountTomans > env.MAX_WALLET_CHARGE_TOMANS
    ) {
      throw new AppError('مبلغ شارژ خارج از بازه مجاز است', 'INVALID_WALLET_RANGE', 400);
    }

    const user = await findOrCreateUserByTelegramId(input.telegramId);

    return prisma.payment.create({
      data: {
        userId: user.id,
        type: PaymentType.WALLET_CHARGE,
        gateway: input.gateway,
        status:
          input.gateway === PaymentGateway.MANUAL
            ? PaymentStatus.WAITING_REVIEW
            : PaymentStatus.PENDING,
        amountTomans: input.amountTomans,
        amountRials: toRials(input.amountTomans),
        hashId: `wallet-${Date.now()}-${input.telegramId}`,
        description: 'شارژ کیف پول',
      },
    });
  }

  async createPurchasePayment(input: {
    telegramId: number;
    planId: string;
    serviceName: string;
    gateway: PaymentGateway;
    promoCode?: string;
  }) {
    const user = await findOrCreateUserByTelegramId(input.telegramId);
    const plan = await prisma.plan.findUnique({ where: { id: input.planId } });

    if (!plan || !plan.isActive) {
      throw new AppError('پلن انتخابی نامعتبر است', 'PLAN_NOT_AVAILABLE', 400);
    }

    const serviceName = ensureServiceName(input.serviceName);

    const duplicate = await prisma.service.findFirst({
      where: {
        userId: user.id,
        name: serviceName,
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new AppError('سرویسی با این نام قبلا ثبت شده است', 'SERVICE_NAME_DUPLICATE', 409);
    }

    const discount = await computeDiscount({
      amountTomans: plan.priceTomans,
      promoCode: input.promoCode,
    });

    if (
      input.gateway === PaymentGateway.WALLET &&
      user.walletBalanceTomans < discount.finalAmountTomans
    ) {
      throw new AppError('موجودی کیف پول کافی نیست', 'INSUFFICIENT_WALLET', 400);
    }

    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        planId: plan.id,
        type: PaymentType.PURCHASE,
        gateway: input.gateway,
        status:
          input.gateway === PaymentGateway.MANUAL
            ? PaymentStatus.WAITING_REVIEW
            : PaymentStatus.PENDING,
        amountTomans: discount.finalAmountTomans,
        amountRials: toRials(discount.finalAmountTomans),
        hashId: `purchase-${Date.now()}-${input.telegramId}`,
        promoCodeId: discount.promoCodeId,
        description: `خرید پلن ${plan.name}`,
        callbackPayload: { serviceName },
      },
    });

    if (input.gateway === PaymentGateway.WALLET) {
      try {
        await walletService.debit({
          userId: user.id,
          amountTomans: discount.finalAmountTomans,
          type: WalletTransactionType.PURCHASE,
          description: `خرید پلن ${plan.name}`,
          paymentId: payment.id,
        });

        await this.processSuccessfulPayment(payment.id);
      } catch (error) {
        await this.markPaymentFailed(payment.id, 'پرداخت از کیف پول ناموفق بود');
        throw error;
      }
    }

    return payment;
  }

  async createRenewPayment(input: {
    telegramId: number;
    serviceId: string;
    gateway: PaymentGateway;
    promoCode?: string;
  }) {
    const user = await findOrCreateUserByTelegramId(input.telegramId);

    const service = await prisma.service.findFirst({
      where: {
        id: input.serviceId,
        userId: user.id,
      },
      include: { plan: true },
    });

    if (!service || !service.plan) {
      throw new AppError('سرویس برای تمدید پیدا نشد', 'SERVICE_NOT_FOUND', 404);
    }

    const discount = await computeDiscount({
      amountTomans: service.plan.priceTomans,
      promoCode: input.promoCode,
    });

    if (
      input.gateway === PaymentGateway.WALLET &&
      user.walletBalanceTomans < discount.finalAmountTomans
    ) {
      throw new AppError('موجودی کیف پول کافی نیست', 'INSUFFICIENT_WALLET', 400);
    }

    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        targetServiceId: service.id,
        planId: service.plan.id,
        type: PaymentType.RENEWAL,
        gateway: input.gateway,
        status:
          input.gateway === PaymentGateway.MANUAL
            ? PaymentStatus.WAITING_REVIEW
            : PaymentStatus.PENDING,
        amountTomans: discount.finalAmountTomans,
        amountRials: toRials(discount.finalAmountTomans),
        hashId: `renew-${Date.now()}-${input.telegramId}`,
        promoCodeId: discount.promoCodeId,
        description: `تمدید سرویس ${service.name}`,
      },
    });

    if (input.gateway === PaymentGateway.WALLET) {
      try {
        await walletService.debit({
          userId: user.id,
          amountTomans: discount.finalAmountTomans,
          type: WalletTransactionType.PURCHASE,
          description: `تمدید سرویس ${service.name}`,
          paymentId: payment.id,
        });

        await this.processSuccessfulPayment(payment.id);
      } catch (error) {
        await this.markPaymentFailed(payment.id, 'تمدید از کیف پول ناموفق بود');
        throw error;
      }
    }

    return payment;
  }

  async createTetra98Order(paymentId: string): Promise<{ authority: string; link: string }> {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });

    if (!payment) {
      throw new AppError('پرداخت پیدا نشد', 'PAYMENT_NOT_FOUND', 404);
    }

    if (payment.gateway !== PaymentGateway.TETRA98 || payment.status !== PaymentStatus.PENDING) {
      throw new AppError('پرداخت برای تترا قابل ایجاد نیست', 'PAYMENT_GATEWAY_INVALID', 400);
    }

    if (payment.authority) {
      return {
        authority: payment.authority,
        link: tetra98Service.getPaymentLink(payment.authority),
      };
    }

    const created = await tetra98Service.createOrder({
      hashId: payment.hashId ?? payment.id,
      amountRials: payment.amountRials,
      callbackUrl: `${env.APP_URL}/callback/tetra98`,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        authority: created.authority,
        callbackPayload:
          payment.callbackPayload && typeof payment.callbackPayload === 'object'
            ? {
                ...(payment.callbackPayload as Prisma.JsonObject),
                tetraAuthority: created.authority,
              }
            : { tetraAuthority: created.authority },
      },
    });

    return {
      authority: created.authority,
      link: tetra98Service.getPaymentLink(created.authority),
    };
  }

  async submitManualReceipt(paymentId: string, fileId: string): Promise<void> {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });

    if (!payment || payment.gateway !== PaymentGateway.MANUAL) {
      throw new AppError('پرداخت دستی پیدا نشد', 'MANUAL_PAYMENT_NOT_FOUND', 404);
    }

    if (
      payment.status !== PaymentStatus.PENDING &&
      payment.status !== PaymentStatus.WAITING_REVIEW
    ) {
      throw new AppError('این پرداخت قابل ارسال رسید نیست', 'MANUAL_PAYMENT_STATUS_INVALID', 400);
    }

    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.WAITING_REVIEW,
        manualReceiptFileId: fileId,
      },
    });
  }

  async processSuccessfulPayment(paymentId: string): Promise<void> {
    const lock = await prisma.payment.updateMany({
      where: {
        id: paymentId,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.WAITING_REVIEW] },
      },
      data: {
        status: PaymentStatus.PROCESSING,
      },
    });

    if (lock.count === 0) {
      const current = await prisma.payment.findUnique({ where: { id: paymentId } });

      if (!current) {
        throw new AppError('پرداخت پیدا نشد', 'PAYMENT_NOT_FOUND', 404);
      }

      if (current.status === PaymentStatus.SUCCESS) {
        return;
      }

      if (current.status === PaymentStatus.PROCESSING) {
        throw new AppError('پرداخت در حال پردازش است', 'PAYMENT_PROCESSING', 409);
      }

      throw new AppError('این پرداخت قابل تکمیل نیست', 'PAYMENT_STATUS_INVALID', 400);
    }

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });

    if (!payment) {
      throw new AppError('پرداخت پیدا نشد', 'PAYMENT_NOT_FOUND', 404);
    }

    try {
      if (payment.type === PaymentType.WALLET_CHARGE) {
        await walletService.credit({
          userId: payment.userId,
          amountTomans: payment.amountTomans,
          type: WalletTransactionType.CHARGE,
          description: 'شارژ کیف پول از درگاه',
          paymentId: payment.id,
        });
      }

      if (payment.type === PaymentType.PURCHASE) {
        await completePurchase(payment);
      }

      if (payment.type === PaymentType.RENEWAL) {
        await completeRenewal(payment);
      }

      await markPromoUsage(payment);
      await rewardAffiliateIfNeeded(payment);

      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCESS,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      logger.error(`Payment completion failed paymentId=${payment.id} error=${String(error)}`);
      await prisma.payment.updateMany({
        where: {
          id: payment.id,
          status: PaymentStatus.PROCESSING,
        },
        data: {
          status: PaymentStatus.FAILED,
          reviewNote: 'تکمیل پرداخت با خطا مواجه شد',
        },
      });
      throw error;
    }
  }

  async markPaymentFailed(paymentId: string, reason: string): Promise<void> {
    await prisma.payment.updateMany({
      where: {
        id: paymentId,
        status: {
          in: [PaymentStatus.PENDING, PaymentStatus.WAITING_REVIEW, PaymentStatus.PROCESSING],
        },
      },
      data: {
        status: PaymentStatus.FAILED,
        reviewNote: reason,
      },
    });
  }

  async rejectManualPayment(paymentId: string, adminUserId: string, note: string): Promise<void> {
    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.CANCELED,
        reviewedByAdminId: adminUserId,
        reviewNote: note,
      },
    });
  }

  async createTestSubscription(
    telegramId: number,
  ): Promise<{ serviceName: string; subscriptionUrl: string }> {
    const user = await findOrCreateUserByTelegramId(telegramId);
    const setting = await prisma.setting.findUnique({ where: { id: 1 } });

    const testEnabled = setting?.testEnabled ?? true;
    if (!testEnabled) {
      throw new AppError('در حال حاضر سرویس تست ارائه نمی‌شود', 'TEST_DISABLED', 400);
    }

    const reserved = await prisma.user.updateMany({
      where: {
        id: user.id,
        usedTestSubscription: false,
      },
      data: {
        usedTestSubscription: true,
      },
    });

    if (reserved.count === 0) {
      throw new AppError('سرویس تست قبلا برای شما فعال شده است', 'TEST_ALREADY_USED', 400);
    }

    const trafficBytes = Number(setting?.testTrafficBytes ?? BigInt(1 * 1024 * 1024 * 1024));
    const durationDays = setting?.testDurationDays ?? 1;
    const expireAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    const serviceName = `test-${Date.now().toString().slice(-4)}`;
    const remnaUsername = buildUniqueRemnaUsername(user.telegramId, serviceName);

    try {
      const created = await remnawaveService.createUser({
        username: remnaUsername,
        trafficLimitBytes: trafficBytes,
        expireAt,
        telegramId,
      });

      const subscription = await remnawaveService
        .getSubscriptionByUuid(created.uuid)
        .catch(() => null);

      await prisma.service.create({
        data: {
          userId: user.id,
          planId: null,
          name: serviceName,
          remnaUsername,
          remnaUserUuid: created.uuid,
          shortUuid: created.shortUuid ?? null,
          subscriptionUrl: created.subscriptionUrl ?? subscription?.subscriptionUrl ?? null,
          trafficLimitBytes: BigInt(trafficBytes),
          expireAt,
          lastKnownUsedBytes: BigInt(0),
          isActive: true,
        },
      });

      return {
        serviceName,
        subscriptionUrl: created.subscriptionUrl ?? subscription?.subscriptionUrl ?? '',
      };
    } catch (error) {
      await prisma.user.update({
        where: { id: user.id },
        data: { usedTestSubscription: false },
      });
      throw error;
    }
  }
}

export const paymentOrchestrator = new PaymentOrchestrator();
