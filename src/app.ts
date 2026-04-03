import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { JSDOM } from 'jsdom';
import { PaymentStatus } from '@prisma/client';
import { createBot } from './bot';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { startCleanupCrons } from './services/cleanup';
import { startNotificationCron } from './services/notification';
import { paymentOrchestrator } from './services/payment-orchestrator';
import { sendPurchaseAccessByPayment } from './services/purchase-delivery';
import { tetra98Service } from './services/tetra98';

const bot = createBot();

// this is needed for the qr code
const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.window = dom.window as any;
global.document = dom.window.document;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.self = dom.window as any;

async function notifyAdmins(text: string): Promise<void> {
  for (const adminId of env.ADMIN_TG_ID_LIST) {
    try {
      await bot.telegram.sendMessage(adminId, text);
    } catch (error) {
      logger.error(`Failed to notify admin ${adminId}: ${String(error)}`);
    }
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

function parseBody(raw: string, contentType: string | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  if (contentType?.includes('application/json')) {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  }

  if (contentType?.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
}

function sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function handleTetra98Callback(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let callbackUserTelegramId: number | null = null;

  try {
    const rawBody = await readBody(req);
    const body = parseBody(rawBody, req.headers['content-type']);
    const statusRaw = body.status ?? body.Status;
    const status = Number(statusRaw);
    const authority = String(body.authority ?? body.Authority ?? '');

    if (!authority || !/^[A-Za-z0-9_-]{6,200}$/.test(authority)) {
      sendJson(res, 400, { ok: false });
      return;
    }

    const payment = await prisma.payment.findFirst({
      where: { authority },
      include: { user: true },
    });

    if (!payment) {
      await notifyAdmins(`Callback تترا98 با authority نامعتبر آمد: ${authority}`);
      sendJson(res, 404, { ok: false });
      return;
    }
    callbackUserTelegramId = Number(payment.user.telegramId);

    if (payment.status === PaymentStatus.SUCCESS || payment.status === PaymentStatus.PROCESSING) {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (status !== 100) {
      await paymentOrchestrator.markPaymentFailed(payment.id, 'پرداخت از طریق callback ناموفق بود');
      await bot.telegram.sendMessage(
        Number(payment.user.telegramId),
        'پرداخت شما ناموفق بود. در صورت کسر وجه با پشتیبانی تماس بگیرید.',
      );
      await notifyAdmins(
        `پرداخت ناموفق تترا98: ${payment.id} | user=${payment.user.telegramId.toString()}`,
      );
      sendJson(res, 200, { ok: false });
      return;
    }

    const verify = await tetra98Service.verify(authority);

    if (!verify.ok) {
      await paymentOrchestrator.markPaymentFailed(payment.id, 'verify تترا98 ناموفق بود');
      await bot.telegram.sendMessage(
        Number(payment.user.telegramId),
        'تایید پرداخت انجام نشد. لطفا با پشتیبانی تماس بگیرید.',
      );
      await notifyAdmins(
        `verify ناموفق تترا98: ${payment.id} | user=${payment.user.telegramId.toString()}`,
      );
      sendJson(res, 200, { ok: false });
      return;
    }

    await paymentOrchestrator.processSuccessfulPayment(payment.id);
    if (payment.type === 'PURCHASE') {
      await sendPurchaseAccessByPayment(bot.telegram, payment.id);
    } else {
      await bot.telegram.sendMessage(
        Number(payment.user.telegramId),
        'پرداخت با موفقیت تایید شد و مبلغ به کیف پول شما اضافه شد.',
      );
    }
    sendJson(res, 200, { ok: true });
  } catch (error) {
    logger.error(`callback tetra98 failed: ${String(error)}`);
    await notifyAdmins(`خطا در callback تترا98: ${String(error)}`);
    if (callbackUserTelegramId) {
      await bot.telegram
        .sendMessage(callbackUserTelegramId, 'پرداخت شما ثبت نشد. لطفا با پشتیبانی تماس بگیرید.')
        .catch(() => undefined);
    }
    sendJson(res, 200, { ok: false });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true, service: 'remnawave-vpn-bot' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/callback/tetra98') {
    await handleTetra98Callback(req, res);
    return;
  }

  sendJson(res, 404, { ok: false, message: 'Not Found' });
});

async function bootstrap(): Promise<void> {
  startNotificationCron(bot);
  startCleanupCrons();

  await new Promise<void>((resolve) => {
    server.listen(env.PORT, () => {
      logger.info(`Server started on ${env.PORT}`);
      resolve();
    });
  });

  await bot.launch();
  logger.info('Bot started with long polling');
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down`);

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  }).catch((error) => {
    logger.error(`HTTP server shutdown failed: ${String(error)}`);
  });

  bot.stop(signal);
  await prisma.$disconnect();
  process.exit(0);
}

bootstrap().catch(async (error) => {
  logger.error(`Bootstrap failed: ${String(error)}`);
  await prisma.$disconnect();
  process.exit(1);
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('unhandledRejection', (error) => {
  logger.error(`Unhandled rejection: ${String(error)}`);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${String(error)}`);
});
