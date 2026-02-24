import cron from 'node-cron';
import type { Telegraf } from 'telegraf';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { bytesToGb, daysLeft } from '../utils/format';
import type { BotContext } from '../types/context';
import { remnawaveService } from './remnawave';

export function startNotificationCron(bot: Telegraf<BotContext>): void {
  cron.schedule(
    '0 16 * * *',
    async () => {
      logger.info('Running daily low-resource notification job');

      const setting = await prisma.setting.findUnique({ where: { id: 1 } });
      const notifyDaysLeft = setting?.notifyDaysLeft ?? 3;
      const notifyGbLeft = setting?.notifyGbLeft ?? 2;

      const services = await prisma.service.findMany({
        where: { isActive: true },
        include: { user: true },
      });

      for (const service of services) {
        try {
          const remote = await remnawaveService.getUserByUsername(service.remnaUsername);

          const remoteExpireAt = remote.expireAt ? new Date(remote.expireAt) : service.expireAt;
          const usedBytes = BigInt(remote.usedTrafficBytes ?? service.lastKnownUsedBytes);
          const limitBytes = BigInt(remote.trafficLimitBytes ?? service.trafficLimitBytes);

          await prisma.service.update({
            where: { id: service.id },
            data: {
              expireAt: remoteExpireAt,
              lastKnownUsedBytes: usedBytes,
              subscriptionUrl: remote.subscriptionUrl ?? service.subscriptionUrl,
              shortUuid: remote.shortUuid ?? service.shortUuid,
            },
          });

          const remainGb = bytesToGb(limitBytes > usedBytes ? limitBytes - usedBytes : BigInt(0));
          const remainDays = daysLeft(remoteExpireAt);

          if (remainGb <= notifyGbLeft || remainDays <= notifyDaysLeft) {
            await bot.telegram.sendMessage(
              Number(service.user.telegramId),
              `از سرویس شما با نام ${service.name} فقط ${Math.floor(remainGb)} گیگابایت / ${Math.max(remainDays, 0)} روز باقی مانده است`,
            );
          }
        } catch (error) {
          logger.error(`Failed notification for service=${service.id} error=${String(error)}`);
        }
      }
    },
    {
      timezone: 'Asia/Tehran',
    },
  );
}
