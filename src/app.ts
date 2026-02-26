import express, { Request, Response } from 'express';
import { PaymentStatus } from '@prisma/client';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { createBot } from './bot';
import { paymentOrchestrator } from './services/payment-orchestrator';
import { tetra98Service } from './services/tetra98';
import { startNotificationCron } from './services/notification';
import { startCleanupCrons } from './services/cleanup';
import { sendPurchaseAccessByPayment } from './services/purchase-delivery';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const bot = createBot();
const webhookPath = env.WEBHOOK_PATH;

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
  let callbackUserTelegramId: number | null = null;

  try {
    const body = req.body as Record<string, unknown>;
    const statusRaw = body.status ?? body.Status;
    const status = Number(statusRaw);
    const authority = String(body.authority ?? body.Authority ?? '');

    if (!authority || !/^[A-Za-z0-9_-]{6,200}$/.test(authority)) {
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
    callbackUserTelegramId = Number(payment.user.telegramId);

    if (payment.status === PaymentStatus.SUCCESS || payment.status === PaymentStatus.PROCESSING) {
      res.status(200).json({ ok: true });
      return;
    }

    if (status !== 100) {
      await paymentOrchestrator.markPaymentFailed(payment.id, 'وضعیت اولیه callback موفق نبود');
      await bot.telegram.sendMessage(
        Number(payment.user.telegramId),
        'پرداخت شما ناموفق بود. در صورت کسر وجه با پشتیبانی تماس بگیرید.',
      );
      await notifyAdmins(
        `پرداخت ناموفق تترا98: ${payment.id} | user=${payment.user.telegramId.toString()}`,
      );
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
      await notifyAdmins(
        `verify ناموفق تترا98: ${payment.id} | user=${payment.user.telegramId.toString()}`,
      );
      res.status(200).json({ ok: false });
      return;
    }

    await paymentOrchestrator.processSuccessfulPayment(payment.id);
    if (payment.type === 'PURCHASE') {
      await sendPurchaseAccessByPayment(bot.telegram, payment.id);
    } else {
      await bot.telegram.sendMessage(
        Number(payment.user.telegramId),
        'پرداخت شما با موفقیت تایید شد و سرویس/کیف پول بروزرسانی شد.',
      );
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    logger.error(`callback tetra98 failed: ${String(error)}`);
    await notifyAdmins(`خطا در callback تترا98: ${String(error)}`);
    if (callbackUserTelegramId) {
      await bot.telegram
        .sendMessage(
          callbackUserTelegramId,
          'پرداخت شما با خطا مواجه شد. لطفا با پشتیبانی تماس بگیرید.',
        )
        .catch(() => undefined);
    }
    res.status(200).json({ ok: false });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'remnawave-vpn-bot' });
});

app.post(webhookPath, bot.webhookCallback(webhookPath));

app.use((req, res, next) => {
  if (req.path === webhookPath) {
    logger.warn(`Webhook path hit with unsupported method=${req.method} ip=${req.ip}`);
  }
  next();
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, message: 'Not Found' });
});

function buildWebhookUrl(): string {
  return `${env.APP_URL.replace(/\/+$/, '')}${webhookPath}`;
}

function sanitizeWebhookErrorMessage(message: string | undefined): string {
  if (!message) {
    return 'none';
  }

  return message.replace(env.BOT_TOKEN, '[REDACTED_TOKEN]');
}

async function configureWebhookWithRetry(): Promise<void> {
  const webhookUrl = buildWebhookUrl();
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= env.WEBHOOK_SET_RETRIES; attempt += 1) {
    try {
      await bot.telegram.setWebhook(webhookUrl);
      const info = await bot.telegram.getWebhookInfo();
      logger.info(
        `Webhook configured url=${info.url} pending=${info.pending_update_count} max_connections=${info.max_connections ?? 'n/a'}`,
      );

      if (info.last_error_message) {
        const normalizedLastError = sanitizeWebhookErrorMessage(info.last_error_message);
        logger.warn(
          `Telegram webhook last_error_date=${info.last_error_date ?? 'n/a'} message=${normalizedLastError}`,
        );

        if (
          normalizedLastError.includes('certificate') ||
          normalizedLastError.includes('SSL') ||
          normalizedLastError.includes('404')
        ) {
          logger.warn(
            'Webhook diagnostics: verify APP_URL HTTPS certificate, NGINX path mapping, and WEBHOOK_PATH exact match.',
          );
        }
      }

      return;
    } catch (error) {
      lastError = error;
      logger.error(
        `Webhook setup failed attempt=${attempt}/${env.WEBHOOK_SET_RETRIES} error=${String(error)}`,
      );
      await new Promise<void>((resolve) => {
        setTimeout(resolve, attempt * 1000);
      });
    }
  }

  logger.error(
    `Webhook setup exhausted all retries. Please verify APP_URL, SSL certificate, and firewall. lastError=${String(lastError)}`,
  );
}

async function bootstrap(): Promise<void> {
  startNotificationCron(bot);
  startCleanupCrons();

  app.listen(env.PORT, () => {
    logger.info(`Server started on ${env.PORT}`);
  });

  await configureWebhookWithRetry();
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

process.on('unhandledRejection', (error) => {
  logger.error(`Unhandled rejection: ${String(error)}`);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${String(error)}`);
});
