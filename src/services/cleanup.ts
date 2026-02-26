import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { remnawaveService } from './remnawave';

async function removeExpiredService(service: {
  id: string;
  name: string;
  remnaUserUuid: string;
  isTest: boolean;
}): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await remnawaveService.deleteUser(service.remnaUserUuid);
      await prisma.service.delete({
        where: { id: service.id },
      });
      logger.info(
        `cleanup deleted service id=${service.id} name=${service.name} isTest=${service.isTest}`,
      );
      return;
    } catch (error) {
      logger.warn(
        `cleanup delete failed attempt=${attempt}/2 service=${service.id} error=${String(error)}`,
      );
    }
  }
}

export function startCleanupCrons(): void {
  cron.schedule(
    '0 3 * * *',
    async () => {
      const now = new Date();
      const expiredTests = await prisma.service.findMany({
        where: {
          isTest: true,
          expireAt: { lt: now },
        },
        select: {
          id: true,
          name: true,
          remnaUserUuid: true,
          isTest: true,
        },
      });

      for (const service of expiredTests) {
        await removeExpiredService(service);
      }
    },
    { timezone: 'Asia/Tehran' },
  );

  cron.schedule(
    '0 4 * * *',
    async () => {
      const threshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const expiredPurchased = await prisma.service.findMany({
        where: {
          isTest: false,
          expireAt: { lt: threshold },
        },
        select: {
          id: true,
          name: true,
          remnaUserUuid: true,
          isTest: true,
        },
      });

      for (const service of expiredPurchased) {
        await removeExpiredService(service);
      }
    },
    { timezone: 'Asia/Tehran' },
  );
}

