import express, { Request, Response } from 'express';
import { PaymentStatus } from '@prisma/client';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { createBot } from './bot';
import { paymentOrchestrator } from './services/payment-orchestrator';
import { tetra98Service } from './services/tetra98';
import { startNotificationCron } from './services/notification';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const bot = createBot();

async function notifyAdmins(text: string): Promise<void> {
  for (const adminId of env.ADMIN_TG_ID_LIST) {
    try {
      await bot.telegram.sendMessage(adminId, text);
    } catch (error) {
      logger.error(`Failed to notify admin ${adminId}: ${String(error)}`);
    }
  }
}

app.post('/callback/tetra98', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const statusRaw = body.status ?? body.Status;
  const status = Number(statusRaw);
  const authority = String(body.authority ?? body.Authority ?? '');

  if (!authority) {
    res.status(400).json({ ok: false });
    return;
  }

  const payment = await prisma.payment.findFirst({
    where: { authority },
    include: { user: true },
  });

  if (!payment) {
    await notifyAdmins(`Callback تترا98 با authority نامعتبر دریافت شد: ${authority}`);
    res.status(404).json({ ok: false });
    return;
  }

  if (payment.status === PaymentStatus.SUCCESS) {
    res.status(200).json({ ok: true });
    return;
  }

  if (status !== 100) {
    await paymentOrchestrator.markPaymentFailed(payment.id, 'وضعیت اولیه callback موفق نبود');
    await bot.telegram.sendMessage(
      Number(payment.user.telegramId),
      'پرداخت شما ناموفق بود. در صورت کسر وجه با پشتیبانی تماس بگیرید.',
    );
    await notifyAdmins(`پرداخت ناموفق تترا98: ${payment.id} | user=${payment.user.telegramId.toString()}`);
    res.status(200).json({ ok: false });
    return;
  }

  const verify = await tetra98Service.verify(authority);

  if (!verify.ok) {
    await paymentOrchestrator.markPaymentFailed(payment.id, 'verify تترا98 ناموفق بود');
    await bot.telegram.sendMessage(
      Number(payment.user.telegramId),
      'تایید پرداخت انجام نشد. با پشتیبانی تماس بگیرید.',
    );
    await notifyAdmins(`verify ناموفق تترا98: ${payment.id} | user=${payment.user.telegramId.toString()}`);
    res.status(200).json({ ok: false });
    return;
  }

  try {
    await paymentOrchestrator.processSuccessfulPayment(payment.id);
    await bot.telegram.sendMessage(
      Number(payment.user.telegramId),
      'پرداخت شما با موفقیت تایید شد و سرویس/کیف پول بروزرسانی شد.',
    );
  } catch (error) {
    await notifyAdmins(`خطا در تکمیل پرداخت ${payment.id}: ${String(error)}`);
    await bot.telegram.sendMessage(
      Number(payment.user.telegramId),
      'پرداخت تایید شد اما در تکمیل سرویس خطا رخ داد. لطفا با پشتیبانی تماس بگیرید.',
    );
  }

  res.status(200).json({ ok: true });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'remnawave-vpn-bot' });
});

async function bootstrap(): Promise<void> {
  const webhookUrl = `${env.APP_URL}${env.WEBHOOK_PATH}`;

  app.use(env.WEBHOOK_PATH, bot.webhookCallback(env.WEBHOOK_PATH));
  await bot.telegram.setWebhook(webhookUrl);
  logger.info(`Webhook set to ${webhookUrl}`);

  startNotificationCron(bot);

  app.listen(env.PORT, () => {
    logger.info(`Server started on ${env.PORT}`);
  });
}

bootstrap().catch(async (error) => {
  logger.error(`Bootstrap failed: ${String(error)}`);
  await prisma.$disconnect();
  process.exit(1);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
