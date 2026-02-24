import { Prisma, WalletTransactionType } from '@prisma/client';
import { AppError } from '../errors/app-error';
import { prisma } from '../lib/prisma';

export class WalletService {
  async getBalance(userId: string): Promise<number> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletBalanceTomans: true },
    });

    if (!user) {
      throw new AppError('کاربر پیدا نشد', 'USER_NOT_FOUND', 404);
    }

    return user.walletBalanceTomans;
  }

  async credit(input: {
    userId: string;
    amountTomans: number;
    type: WalletTransactionType;
    description: string;
    paymentId?: string;
  }): Promise<number> {
    if (input.amountTomans <= 0) {
      throw new AppError('مبلغ واریز کیف پول نامعتبر است', 'INVALID_WALLET_AMOUNT', 400);
    }

    return this.applyDelta({
      ...input,
      delta: input.amountTomans,
    });
  }

  async debit(input: {
    userId: string;
    amountTomans: number;
    type: WalletTransactionType;
    description: string;
    paymentId?: string;
  }): Promise<number> {
    if (input.amountTomans <= 0) {
      throw new AppError('مبلغ برداشت کیف پول نامعتبر است', 'INVALID_WALLET_AMOUNT', 400);
    }

    return this.applyDelta({
      ...input,
      delta: -input.amountTomans,
    });
  }

  private async applyDelta(input: {
    userId: string;
    delta: number;
    type: WalletTransactionType;
    description: string;
    paymentId?: string;
  }): Promise<number> {
    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { walletBalanceTomans: true },
      });

      if (!user) {
        throw new AppError('کاربر پیدا نشد', 'USER_NOT_FOUND', 404);
      }

      const nextBalance = user.walletBalanceTomans + input.delta;
      if (nextBalance < 0) {
        throw new AppError('موجودی کیف پول کافی نیست', 'INSUFFICIENT_WALLET', 400);
      }

      await tx.user.update({
        where: { id: input.userId },
        data: { walletBalanceTomans: nextBalance },
      });

      await tx.walletTransaction.create({
        data: {
          userId: input.userId,
          paymentId: input.paymentId,
          amountTomans: input.delta,
          balanceAfterTomans: nextBalance,
          type: input.type,
          description: input.description,
        },
      });

      return nextBalance;
    });

    return updated;
  }
}

export const walletService = new WalletService();
