## package.json
```json
{
  "name": "remnawave-vpn-telegram-bot",
  "version": "1.0.0",
  "private": true,
  "description": "Telegram VPN shop bot for Remnawave + Tetra98",
  "main": "dist/app.js",
  "scripts": {
    "dev": "tsx watch src/app.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/app.js",
    "lint": "eslint . --ext .ts",
    "format": "prettier --write .",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy",
    "db:seed": "tsx prisma/seed.ts",
    "backup:db": "bash scripts/backup-db.sh"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  },
  "keywords": [
    "telegram",
    "vpn",
    "remnawave",
    "tetra98",
    "typescript"
  ],
  "author": "",
  "license": "MIT",
  "packageManager": "pnpm@10.14.0",
  "dependencies": {
    "@prisma/client": "^6.4.1",
    "@remnawave/backend-contract": "^2.6.1",
    "axios": "^1.8.1",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "node-cron": "^3.0.3",
    "telegraf": "^4.16.3",
    "telegraf-ratelimit": "^2.0.0",
    "winston": "^3.17.0",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.13.8",
    "@typescript-eslint/eslint-plugin": "^8.25.0",
    "@typescript-eslint/parser": "^8.25.0",
    "eslint": "^8.57.1",
    "eslint-config-prettier": "^10.0.1",
    "prettier": "^3.5.2",
    "prisma": "^6.4.1",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2"
  }
}
```

## tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "lib": ["ES2022"],
    "moduleResolution": "Node",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "prisma/seed.ts"],
  "exclude": ["node_modules", "dist"]
}
```

## .eslintrc
```json
{
  "root": true,
  "env": {
    "node": true,
    "es2022": true
  },
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "project": false,
    "sourceType": "module"
  },
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/explicit-function-return-type": "off"
  }
}
```

## .prettierrc
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

## .gitignore
```gitignore
node_modules
dist
.env
.env.*
!.env.example
coverage
npm-debug.log*
pnpm-debug.log*
.DS_Store
prisma/dev.db
backups/*.sql
```

## .env.example
```dotenv
NODE_ENV=production
PORT=3000
APP_URL=https://example.com
WEBHOOK_PATH=/telegram/webhook
BOT_TOKEN=123456:telegram-bot-token
BOT_USERNAME=your_bot_username
ADMIN_TG_IDS=111111111,222222222
ADMIN_TG_HANDLE=your_admin_username

DATABASE_URL=postgresql://vpn_bot:vpn_bot_password@localhost:5432/vpn_bot?schema=public

REMNAWAVE_URL=https://your-panel.com
REMNAWAVE_TOKEN=your_remnawave_token

TETRA98_API_KEY=your_tetra98_api_key
MANUAL_CARD_NUMBER=6037990000000000

MIN_WALLET_CHARGE_TOMANS=10000
MAX_WALLET_CHARGE_TOMANS=10000000
```

## Dockerfile
```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN corepack enable && pnpm install --frozen-lockfile=false

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm prisma generate && pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
CMD ["node", "dist/app.js"]
```

## docker-compose.yml
```yaml
version: '3.9'
services:
  db:
    image: postgres:16-alpine
    container_name: remnawave_bot_db
    restart: unless-stopped
    environment:
      POSTGRES_DB: vpn_bot
      POSTGRES_USER: vpn_bot
      POSTGRES_PASSWORD: vpn_bot_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - '5432:5432'

  app:
    build: .
    container_name: remnawave_bot_app
    restart: unless-stopped
    depends_on:
      - db
    env_file:
      - .env
    ports:
      - '3000:3000'

volumes:
  postgres_data:
```

## ecosystem.config.js
```js
module.exports = {
  apps: [
    {
      name: 'remnawave-vpn-bot',
      script: 'dist/app.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
```

## scripts/backup-db.sh
```bash
#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required"
  exit 1
fi

mkdir -p backups
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT_FILE="backups/db_${TIMESTAMP}.sql"

pg_dump "$DATABASE_URL" > "$OUTPUT_FILE"
echo "Backup created: $OUTPUT_FILE"
```

## prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PaymentType {
  WALLET_CHARGE
  PURCHASE
  RENEWAL
}

enum PaymentGateway {
  TETRA98
  WALLET
  MANUAL
}

enum PaymentStatus {
  PENDING
  WAITING_REVIEW
  SUCCESS
  FAILED
  CANCELED
}

enum WalletTransactionType {
  CHARGE
  PURCHASE
  ADMIN_ADJUST
  AFFILIATE_REWARD
}

enum AffiliateRewardType {
  FIXED
  PERCENT
}

model User {
  id                        String              @id @default(cuid())
  telegramId                BigInt              @unique
  telegramUsername          String?
  firstName                 String?
  lastName                  String?
  isBanned                  Boolean             @default(false)
  walletBalanceTomans       Int                 @default(0)
  usedTestSubscription      Boolean             @default(false)
  firstPurchaseAt           DateTime?
  affiliateRewardProcessed  Boolean             @default(false)
  referredById              String?
  referredBy                User?               @relation("UserReferrals", fields: [referredById], references: [id], onDelete: SetNull)
  referrals                 User[]              @relation("UserReferrals")
  services                  Service[]
  payments                  Payment[]           @relation("UserPayments")
  reviewedPayments          Payment[]           @relation("AdminReviews")
  walletTransactions        WalletTransaction[]
  promoUsages               PromoUsage[]
  createdAt                 DateTime            @default(now())
  updatedAt                 DateTime            @updatedAt

  @@index([referredById])
}

model Plan {
  id           String    @id @default(cuid())
  name         String
  trafficGb    Int
  durationDays Int
  priceTomans  Int
  isActive     Boolean   @default(true)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  services     Service[]
  payments     Payment[]

  @@unique([name, trafficGb, durationDays])
}

model Service {
  id                String    @id @default(cuid())
  userId            String
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  planId            String?
  plan              Plan?     @relation(fields: [planId], references: [id], onDelete: SetNull)
  name              String
  remnaUsername     String    @unique
  remnaUserUuid     String    @unique
  shortUuid         String?
  subscriptionUrl   String?
  trafficLimitBytes BigInt
  expireAt          DateTime
  isActive          Boolean   @default(true)
  lastKnownUsedBytes BigInt   @default(0)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  payments          Payment[]

  @@unique([userId, name])
  @@index([userId])
}

model Payment {
  id                String             @id @default(cuid())
  userId            String
  user              User               @relation("UserPayments", fields: [userId], references: [id], onDelete: Cascade)
  type              PaymentType
  gateway           PaymentGateway
  status            PaymentStatus      @default(PENDING)
  amountTomans      Int
  amountRials       Int
  authority         String?            @unique
  hashId            String?            @unique
  description       String?
  targetServiceId   String?
  targetService     Service?           @relation(fields: [targetServiceId], references: [id], onDelete: SetNull)
  planId            String?
  plan              Plan?              @relation(fields: [planId], references: [id], onDelete: SetNull)
  promoCodeId       String?
  promoCode         PromoCode?         @relation(fields: [promoCodeId], references: [id], onDelete: SetNull)
  manualReceiptFileId String?
  callbackPayload   Json?
  reviewedByAdminId String?
  reviewedByAdmin   User?              @relation("AdminReviews", fields: [reviewedByAdminId], references: [id], onDelete: SetNull)
  reviewNote        String?
  completedAt       DateTime?
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
  walletTransactions WalletTransaction[]
  promoUsages       PromoUsage[]

  @@index([userId])
  @@index([targetServiceId])
  @@index([status])
}

model WalletTransaction {
  id                String                 @id @default(cuid())
  userId            String
  user              User                   @relation(fields: [userId], references: [id], onDelete: Cascade)
  paymentId         String?
  payment           Payment?               @relation(fields: [paymentId], references: [id], onDelete: SetNull)
  amountTomans      Int
  balanceAfterTomans Int
  type              WalletTransactionType
  description       String
  createdAt         DateTime               @default(now())

  @@index([userId])
}

model PromoCode {
  id              String      @id @default(cuid())
  code            String      @unique
  discountPercent Int?
  fixedTomans     Int?
  usesLeft        Int
  isActive        Boolean     @default(true)
  expiresAt       DateTime?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt
  payments        Payment[]
  usages          PromoUsage[]
}

model PromoUsage {
  id          String    @id @default(cuid())
  promoCodeId String
  promoCode   PromoCode @relation(fields: [promoCodeId], references: [id], onDelete: Cascade)
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  paymentId   String    @unique
  payment     Payment   @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  createdAt   DateTime  @default(now())

  @@index([promoCodeId])
  @@index([userId])
}

model Setting {
  id                  Int                 @id @default(1)
  testEnabled         Boolean             @default(true)
  testTrafficBytes    BigInt              @default(1073741824)
  testDurationDays    Int                 @default(1)
  notifyDaysLeft      Int                 @default(3)
  notifyGbLeft        Int                 @default(2)
  affiliateRewardType AffiliateRewardType @default(FIXED)
  affiliateRewardValue Int                @default(10000)
  manualCardNumber    String?
  supportHandle       String?
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
}
```

## prisma/seed.ts
```ts
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
```

## prisma/migrations/20260224150000_init/migration.sql
```sql
-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('WALLET_CHARGE', 'PURCHASE', 'RENEWAL');

-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('TETRA98', 'WALLET', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'WAITING_REVIEW', 'SUCCESS', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('CHARGE', 'PURCHASE', 'ADMIN_ADJUST', 'AFFILIATE_REWARD');

-- CreateEnum
CREATE TYPE "AffiliateRewardType" AS ENUM ('FIXED', 'PERCENT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "telegramUsername" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "walletBalanceTomans" INTEGER NOT NULL DEFAULT 0,
    "usedTestSubscription" BOOLEAN NOT NULL DEFAULT false,
    "firstPurchaseAt" TIMESTAMP(3),
    "affiliateRewardProcessed" BOOLEAN NOT NULL DEFAULT false,
    "referredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trafficGb" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "priceTomans" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT,
    "name" TEXT NOT NULL,
    "remnaUsername" TEXT NOT NULL,
    "remnaUserUuid" TEXT NOT NULL,
    "shortUuid" TEXT,
    "subscriptionUrl" TEXT,
    "trafficLimitBytes" BIGINT NOT NULL,
    "expireAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastKnownUsedBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PaymentType" NOT NULL,
    "gateway" "PaymentGateway" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountTomans" INTEGER NOT NULL,
    "amountRials" INTEGER NOT NULL,
    "authority" TEXT,
    "hashId" TEXT,
    "description" TEXT,
    "targetServiceId" TEXT,
    "planId" TEXT,
    "promoCodeId" TEXT,
    "manualReceiptFileId" TEXT,
    "callbackPayload" JSONB,
    "reviewedByAdminId" TEXT,
    "reviewNote" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentId" TEXT,
    "amountTomans" INTEGER NOT NULL,
    "balanceAfterTomans" INTEGER NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountPercent" INTEGER,
    "fixedTomans" INTEGER,
    "usesLeft" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoUsage" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "testEnabled" BOOLEAN NOT NULL DEFAULT true,
    "testTrafficBytes" BIGINT NOT NULL DEFAULT 1073741824,
    "testDurationDays" INTEGER NOT NULL DEFAULT 1,
    "notifyDaysLeft" INTEGER NOT NULL DEFAULT 3,
    "notifyGbLeft" INTEGER NOT NULL DEFAULT 2,
    "affiliateRewardType" "AffiliateRewardType" NOT NULL DEFAULT 'FIXED',
    "affiliateRewardValue" INTEGER NOT NULL DEFAULT 10000,
    "manualCardNumber" TEXT,
    "supportHandle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE INDEX "User_referredById_idx" ON "User"("referredById");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_name_trafficGb_durationDays_key" ON "Plan"("name", "trafficGb", "durationDays");

-- CreateIndex
CREATE UNIQUE INDEX "Service_remnaUsername_key" ON "Service"("remnaUsername");

-- CreateIndex
CREATE UNIQUE INDEX "Service_remnaUserUuid_key" ON "Service"("remnaUserUuid");

-- CreateIndex
CREATE UNIQUE INDEX "Service_userId_name_key" ON "Service"("userId", "name");

-- CreateIndex
CREATE INDEX "Service_userId_idx" ON "Service"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_authority_key" ON "Payment"("authority");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_hashId_key" ON "Payment"("hashId");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE INDEX "Payment_targetServiceId_idx" ON "Payment"("targetServiceId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "WalletTransaction_userId_idx" ON "WalletTransaction"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PromoUsage_paymentId_key" ON "PromoUsage"("paymentId");

-- CreateIndex
CREATE INDEX "PromoUsage_promoCodeId_idx" ON "PromoUsage"("promoCodeId");

-- CreateIndex
CREATE INDEX "PromoUsage_userId_idx" ON "PromoUsage"("userId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_targetServiceId_fkey" FOREIGN KEY ("targetServiceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoUsage" ADD CONSTRAINT "PromoUsage_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoUsage" ADD CONSTRAINT "PromoUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoUsage" ADD CONSTRAINT "PromoUsage_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

## src/app.ts
```ts
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
```

## src/bot.ts
```ts
import { session, Telegraf, Scenes } from 'telegraf';
import rateLimit from 'telegraf-ratelimit';
import { env } from './config/env';
import { registerAdminCommands } from './commands/admin';
import { registerBuyCommands } from './commands/buy';
import { registerRenewCommands } from './commands/renew';
import { registerStartHandlers } from './commands/start';
import { AppError } from './errors/app-error';
import { logger } from './lib/logger';
import { ensureKnownUser } from './middlewares/auth';
import { buyWizardScene } from './scenes/buy';
import { renewWizardScene } from './scenes/renew';
import { walletChargeWizardScene } from './scenes/wallet-charge';
import type { BotContext } from './types/context';
import type { BotSession } from './types/session';
import { fa } from './utils/farsi';
import { paymentOrchestrator } from './services/payment-orchestrator';

export function createBot(): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(env.BOT_TOKEN);

  const stage = new Scenes.Stage<BotContext>([
    buyWizardScene,
    renewWizardScene,
    walletChargeWizardScene,
  ]);

  bot.use(
    rateLimit({
      window: 3000,
      limit: 1,
      onLimitExceeded: (ctx) => {
        void ctx.reply('درخواست های شما بیش از حد سریع است. چند ثانیه صبر کنید.');
      },
    }),
  );

  bot.use(
    session({
      defaultSession: (): BotSession => ({}),
    }),
  );

  bot.use(ensureKnownUser);
  bot.use(stage.middleware());

  registerStartHandlers(bot);
  registerBuyCommands(bot);
  registerRenewCommands(bot);
  registerAdminCommands(bot);

  bot.hears(fa.menu.test, async (ctx) => {
    if (!ctx.from) {
      return;
    }

    try {
      const result = await paymentOrchestrator.createTestSubscription(ctx.from.id);
      await ctx.reply(
        `سرویس تست با نام ${result.serviceName} فعال شد.\nلینک اشتراک:\n${result.subscriptionUrl}`,
      );
    } catch (error) {
      if (error instanceof AppError && error.code === 'TEST_DISABLED') {
        await ctx.reply('در حال حاضر سرویس تست ارائه نمی‌شود');
        return;
      }

      const message = error instanceof AppError ? error.message : 'خطا در ایجاد سرویس تست';
      await ctx.reply(message);
    }
  });

  bot.action('wallet_charge', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('wallet-charge-wizard');
  });

  bot.catch((error) => {
    logger.error(`Bot error: ${String(error)}`);
  });

  return bot;
}
```

## src/config/env.ts
```ts
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url(),
  WEBHOOK_PATH: z.string().default('/telegram/webhook'),
  BOT_TOKEN: z.string().min(10),
  BOT_USERNAME: z.string().min(3),
  ADMIN_TG_IDS: z.string().min(1),
  ADMIN_TG_HANDLE: z.string().min(3),
  DATABASE_URL: z.string().min(10),
  REMNAWAVE_URL: z.string().url(),
  REMNAWAVE_TOKEN: z.string().min(10),
  TETRA98_API_KEY: z.string().min(10),
  MANUAL_CARD_NUMBER: z.string().min(8),
  MIN_WALLET_CHARGE_TOMANS: z.coerce.number().int().positive().default(10000),
  MAX_WALLET_CHARGE_TOMANS: z.coerce.number().int().positive().default(10000000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.errors
    .map((err) => `${err.path.join('.')}: ${err.message}`)
    .join('; ');
  throw new Error(`Invalid env vars: ${formatted}`);
}

function parseAdminIds(raw: string): number[] {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value));
}

export const env = {
  ...parsed.data,
  ADMIN_TG_ID_LIST: parseAdminIds(parsed.data.ADMIN_TG_IDS),
};

export type Env = typeof env;
```

## src/lib/logger.ts
```ts
import { createLogger, format, transports } from 'winston';
import { env } from '../config/env';

export const logger = createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, stack }) => {
      if (stack) {
        return `${timestamp} [${level}] ${message} ${stack}`;
      }

      return `${timestamp} [${level}] ${message}`;
    }),
  ),
  transports: [new transports.Console()],
});
```

## src/lib/prisma.ts
```ts
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
```

## src/errors/app-error.ts
```ts
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code = 'APP_ERROR', statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}
```

## src/types/session.ts
```ts
import { Scenes } from 'telegraf';

export interface BotSession extends Scenes.WizardSessionData {
  captcha?: {
    answer: string;
    verified: boolean;
  };
  pendingManualPaymentId?: string;
}

export interface BuyWizardState {
  planId?: string;
  planPriceTomans?: number;
  serviceName?: string;
  promoCode?: string;
  finalAmountTomans?: number;
}

export interface RenewWizardState {
  serviceId?: string;
  planId?: string;
  planPriceTomans?: number;
  promoCode?: string;
  finalAmountTomans?: number;
}

export interface WalletWizardState {
  amountTomans?: number;
}

export type BotSceneContext = Scenes.WizardContext<BotSession>;
```

## src/types/context.ts
```ts
import { Context, Scenes } from 'telegraf';
import { BotSession } from './session';

export type BotContext = Context &
  Scenes.WizardContext<BotSession> & {
    session: BotSession;
  };
```

## src/middlewares/auth.ts
```ts
import type { MiddlewareFn } from 'telegraf';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import type { BotContext } from '../types/context';

export const ensureKnownUser: MiddlewareFn<BotContext> = async (ctx, next) => {
  if (!ctx.from) {
    return;
  }

  const telegramId = BigInt(ctx.from.id);

  const user = await prisma.user.upsert({
    where: { telegramId },
    update: {
      telegramUsername: ctx.from.username ?? null,
      firstName: ctx.from.first_name ?? null,
      lastName: ctx.from.last_name ?? null,
    },
    create: {
      telegramId,
      telegramUsername: ctx.from.username ?? null,
      firstName: ctx.from.first_name ?? null,
      lastName: ctx.from.last_name ?? null,
    },
  });

  if (user.isBanned) {
    await ctx.reply('دسترسی شما مسدود شده است.');
    return;
  }

  await next();
};

export const ensureAdmin: MiddlewareFn<BotContext> = async (ctx, next) => {
  if (!ctx.from) {
    return;
  }

  if (!env.ADMIN_TG_ID_LIST.includes(ctx.from.id)) {
    await ctx.reply('این دستور فقط برای ادمین است.');
    return;
  }

  await next();
};
```

## src/utils/currency.ts
```ts
export function toRials(tomans: number): number {
  return tomans * 10;
}

export function toTomans(rials: number): number {
  return Math.floor(rials / 10);
}

export function formatTomans(amount: number): string {
  return `${amount.toLocaleString('fa-IR')} تومان`;
}
```

## src/utils/format.ts
```ts
const GIGABYTE = 1024 ** 3;

export function bytesToGb(bytes: bigint | number): number {
  const raw = typeof bytes === 'bigint' ? Number(bytes) : bytes;
  return Math.max(0, raw / GIGABYTE);
}

export function daysLeft(expireAt: Date): number {
  const diff = expireAt.getTime() - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function sanitizeServiceName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 24);
}
```

## src/utils/farsi.ts
```ts
export const fa = {
  menu: {
    buy: 'خرید پلن',
    renew: 'تمدید سرویس',
    myServices: 'سرویس های من',
    test: 'دریافت سرویس تست',
    wallet: 'کیف پول',
    invite: 'دعوت دوستان',
    support: 'پشتیبانی',
    back: 'بازگشت',
  },
  errors: {
    generic: 'خطا رخ داد. لطفا دوباره تلاش کنید.',
    banned: 'دسترسی شما مسدود شده است. برای پیگیری به پشتیبانی پیام دهید.',
    notEnoughWallet: 'موجودی کیف پول کافی نیست.',
  },
};
```

## src/services/remnawave.ts
```ts
import axios, { AxiosError, Method } from 'axios';
import {
  CreateUserCommand,
  DeleteUserCommand,
  GetSubscriptionByUuidCommand,
  GetUserByUsernameCommand,
  ResetUserTrafficCommand,
  RESET_PERIODS,
  UpdateUserCommand,
  USERS_STATUS,
} from '@remnawave/backend-contract';
import { z } from 'zod';
import { env } from '../config/env';
import { logger } from '../lib/logger';

const api = axios.create({
  baseURL: env.REMNAWAVE_URL,
  timeout: 20000,
  headers: {
    Authorization: `Bearer ${env.REMNAWAVE_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

async function execCommand<TResponse>(args: {
  method: Method;
  url: string;
  params?: Record<string, unknown>;
  data?: unknown;
  schema?: z.ZodType<TResponse>;
}): Promise<TResponse> {
  try {
    const res = await api.request<TResponse>({
      method: args.method,
      url: args.url,
      params: args.params,
      data: args.data,
    });

    return args.schema ? args.schema.parse(res.data) : res.data;
  } catch (error) {
    const err = error as AxiosError<unknown>;
    logger.error(
      `Remnawave request failed status=${err.response?.status ?? 'unknown'} url=${args.url}`,
    );
    throw error;
  }
}

export interface CreateRemnaUserInput {
  username: string;
  trafficLimitBytes: number;
  expireAt: Date;
  telegramId: number;
}

export interface UpdateRemnaUserInput {
  uuid: string;
  trafficLimitBytes: number;
  expireAt: Date;
  enabled?: boolean;
}

export class RemnawaveService {
  async createUser(input: CreateRemnaUserInput) {
    const response = await execCommand<CreateUserCommand.Response>({
      method: CreateUserCommand.endpointDetails.REQUEST_METHOD,
      url: CreateUserCommand.url,
      data: {
        username: input.username,
        trafficLimitBytes: input.trafficLimitBytes,
        expireAt: input.expireAt.toISOString(),
        telegramId: input.telegramId,
        status: USERS_STATUS.ACTIVE,
        trafficLimitStrategy: RESET_PERIODS.NO_RESET,
      } satisfies CreateUserCommand.Request,
      schema: CreateUserCommand.ResponseSchema,
    });

    return response.response;
  }

  async updateUser(input: UpdateRemnaUserInput) {
    const response = await execCommand<UpdateUserCommand.Response>({
      method: UpdateUserCommand.endpointDetails.REQUEST_METHOD,
      url: UpdateUserCommand.url,
      data: {
        uuid: input.uuid,
        trafficLimitBytes: input.trafficLimitBytes,
        expireAt: input.expireAt.toISOString(),
        status: input.enabled === false ? USERS_STATUS.DISABLED : USERS_STATUS.ACTIVE,
      } satisfies UpdateUserCommand.Request,
      schema: UpdateUserCommand.ResponseSchema,
    });

    return response.response;
  }

  async getUserByUsername(username: string) {
    const response = await execCommand<GetUserByUsernameCommand.Response>({
      method: GetUserByUsernameCommand.endpointDetails.REQUEST_METHOD,
      url: GetUserByUsernameCommand.url(username),
      schema: GetUserByUsernameCommand.ResponseSchema,
    });

    return response.response;
  }

  async deleteUser(uuid: string): Promise<void> {
    await execCommand<DeleteUserCommand.Response>({
      method: DeleteUserCommand.endpointDetails.REQUEST_METHOD,
      url: DeleteUserCommand.url(uuid),
      schema: DeleteUserCommand.ResponseSchema,
    });
  }

  async getSubscriptionByUuid(uuid: string) {
    const response = await execCommand<GetSubscriptionByUuidCommand.Response>({
      method: GetSubscriptionByUuidCommand.endpointDetails.REQUEST_METHOD,
      url: GetSubscriptionByUuidCommand.url(uuid),
      schema: GetSubscriptionByUuidCommand.ResponseSchema,
    });

    return response.response;
  }

  async resetTraffic(uuid: string): Promise<void> {
    await execCommand<ResetUserTrafficCommand.Response>({
      method: ResetUserTrafficCommand.endpointDetails.REQUEST_METHOD,
      url: ResetUserTrafficCommand.url(uuid),
      schema: ResetUserTrafficCommand.ResponseSchema,
    });
  }
}

export const remnawaveService = new RemnawaveService();
```

## src/services/tetra98.ts
```ts
import axios from 'axios';
import { env } from '../config/env';
import { AppError } from '../errors/app-error';

const tetraApi = axios.create({
  baseURL: 'https://tetra98.ir',
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
  },
});

interface CreateOrderResponse {
  status?: number;
  Status?: number;
  authority?: string;
  Authority?: string;
  [key: string]: unknown;
}

interface VerifyResponse {
  status?: number;
  Status?: number;
  RefID?: string;
  ref_id?: string;
  [key: string]: unknown;
}

export class Tetra98Service {
  async createOrder(input: {
    hashId: string;
    amountRials: number;
    callbackUrl: string;
  }): Promise<{ authority: string; raw: CreateOrderResponse }> {
    const { data } = await tetraApi.post<CreateOrderResponse>('/api/create_order', {
      ApiKey: env.TETRA98_API_KEY,
      Hash_id: input.hashId,
      Amount: input.amountRials,
      CallbackURL: input.callbackUrl,
    });

    const status = data.status ?? data.Status;
    const authority = (data.authority ?? data.Authority ?? '').toString();

    if (status !== 100 || !authority) {
      throw new AppError('خطا در ایجاد سفارش پرداخت', 'TETRA98_CREATE_FAILED', 400);
    }

    return { authority, raw: data };
  }

  async verify(authority: string): Promise<{ ok: boolean; raw: VerifyResponse }> {
    const { data } = await tetraApi.post<VerifyResponse>('/api/verify', {
      ApiKey: env.TETRA98_API_KEY,
      authority,
    });

    const status = data.status ?? data.Status;

    return { ok: status === 100, raw: data };
  }

  getPaymentLink(authority: string): string {
    return `https://t.me/Tetra98_bot?start=pay_${authority}`;
  }
}

export const tetra98Service = new Tetra98Service();
```

## src/services/wallet.ts
```ts
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
```

## src/services/payment-orchestrator.ts
```ts
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
        usesLeft: {
          decrement: 1,
        },
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
    include: {
      referredBy: true,
    },
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

  if (rewardTomans <= 0) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        affiliateRewardProcessed: true,
        firstPurchaseAt: new Date(),
      },
    });
    return;
  }

  await walletService.credit({
    userId: user.referredById,
    amountTomans: rewardTomans,
    type: WalletTransactionType.AFFILIATE_REWARD,
    description: `پاداش همکاری فروش از خرید کاربر ${user.telegramId.toString()}`,
    paymentId: payment.id,
  });

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

function readServiceNameFromPayload(payload: Prisma.JsonValue | null): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError('اطلاعات پرداخت ناقص است', 'PAYLOAD_INVALID', 400);
  }

  const payloadObject = payload as Prisma.JsonObject;
  const maybeServiceName = payloadObject.serviceName;
  if (typeof maybeServiceName !== 'string' || maybeServiceName.trim().length < 2) {
    throw new AppError('نام سرویس نامعتبر است', 'SERVICE_NAME_INVALID', 400);
  }

  return maybeServiceName;
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
  const trafficLimitBytes = calculateBytes(plan.trafficGb);
  const expireAt = new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000);
  const remnaUsername = buildUniqueRemnaUsername(user.telegramId, serviceName);

  const created = await remnawaveService.createUser({
    username: remnaUsername,
    trafficLimitBytes,
    expireAt,
    telegramId: Number(user.telegramId),
  });

  await prisma.service.create({
    data: {
      userId: user.id,
      planId: plan.id,
      name: serviceName,
      remnaUsername,
      remnaUserUuid: created.uuid,
      shortUuid: created.shortUuid ?? null,
      subscriptionUrl: created.subscriptionUrl ?? null,
      trafficLimitBytes: BigInt(trafficLimitBytes),
      expireAt,
      lastKnownUsedBytes: BigInt(0),
      isActive: true,
    },
  });
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
    const user = await findOrCreateUserByTelegramId(input.telegramId);

    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        type: PaymentType.WALLET_CHARGE,
        gateway: input.gateway,
        status: input.gateway === PaymentGateway.MANUAL ? PaymentStatus.WAITING_REVIEW : PaymentStatus.PENDING,
        amountTomans: input.amountTomans,
        amountRials: toRials(input.amountTomans),
        hashId: `wallet-${Date.now()}-${input.telegramId}`,
        description: 'شارژ کیف پول',
      },
    });

    return payment;
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

    const discount = await computeDiscount({
      amountTomans: plan.priceTomans,
      promoCode: input.promoCode,
    });

    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        planId: plan.id,
        type: PaymentType.PURCHASE,
        gateway: input.gateway,
        status: input.gateway === PaymentGateway.MANUAL ? PaymentStatus.WAITING_REVIEW : PaymentStatus.PENDING,
        amountTomans: discount.finalAmountTomans,
        amountRials: toRials(discount.finalAmountTomans),
        hashId: `purchase-${Date.now()}-${input.telegramId}`,
        promoCodeId: discount.promoCodeId,
        description: `خرید پلن ${plan.name}`,
        callbackPayload: {
          serviceName: input.serviceName,
        },
      },
    });

    if (input.gateway === PaymentGateway.WALLET) {
      await walletService.debit({
        userId: user.id,
        amountTomans: discount.finalAmountTomans,
        type: WalletTransactionType.PURCHASE,
        description: `خرید پلن ${plan.name}`,
        paymentId: payment.id,
      });

      await this.processSuccessfulPayment(payment.id);
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

    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        targetServiceId: service.id,
        planId: service.plan.id,
        type: PaymentType.RENEWAL,
        gateway: input.gateway,
        status: input.gateway === PaymentGateway.MANUAL ? PaymentStatus.WAITING_REVIEW : PaymentStatus.PENDING,
        amountTomans: discount.finalAmountTomans,
        amountRials: toRials(discount.finalAmountTomans),
        hashId: `renew-${Date.now()}-${input.telegramId}`,
        promoCodeId: discount.promoCodeId,
        description: `تمدید سرویس ${service.name}`,
      },
    });

    if (input.gateway === PaymentGateway.WALLET) {
      await walletService.debit({
        userId: user.id,
        amountTomans: discount.finalAmountTomans,
        type: WalletTransactionType.PURCHASE,
        description: `تمدید سرویس ${service.name}`,
        paymentId: payment.id,
      });

      await this.processSuccessfulPayment(payment.id);
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
            ? { ...(payment.callbackPayload as object), tetraCreate: created.raw }
            : { tetraCreate: created.raw },
      },
    });

    return {
      authority: created.authority,
      link: tetra98Service.getPaymentLink(created.authority),
    };
  }

  async submitManualReceipt(paymentId: string, fileId: string): Promise<void> {
    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.WAITING_REVIEW,
        manualReceiptFileId: fileId,
      },
    });
  }

  async processSuccessfulPayment(paymentId: string): Promise<void> {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });

    if (!payment) {
      throw new AppError('پرداخت پیدا نشد', 'PAYMENT_NOT_FOUND', 404);
    }

    if (payment.status === PaymentStatus.SUCCESS) {
      return;
    }

    if (![PaymentStatus.PENDING, PaymentStatus.WAITING_REVIEW].includes(payment.status)) {
      throw new AppError('این پرداخت قابل تکمیل نیست', 'PAYMENT_STATUS_INVALID', 400);
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
      logger.error(`Payment completion failed paymentId=${payment.id}`);
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          reviewNote: 'تکمیل پرداخت با خطا مواجه شد',
        },
      });
      throw error;
    }
  }

  async markPaymentFailed(paymentId: string, reason: string): Promise<void> {
    await prisma.payment.update({
      where: { id: paymentId },
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

  async createTestSubscription(telegramId: number): Promise<{ serviceName: string; subscriptionUrl: string }> {
    const user = await findOrCreateUserByTelegramId(telegramId);
    const setting = await prisma.setting.findUnique({ where: { id: 1 } });

    const testEnabled = setting?.testEnabled ?? true;
    if (!testEnabled) {
      throw new AppError('در حال حاضر سرویس تست ارائه نمی‌شود', 'TEST_DISABLED', 400);
    }

    if (user.usedTestSubscription) {
      throw new AppError('سرویس تست قبلا برای شما فعال شده است', 'TEST_ALREADY_USED', 400);
    }

    const trafficBytes = Number(setting?.testTrafficBytes ?? BigInt(1 * 1024 * 1024 * 1024));
    const durationDays = setting?.testDurationDays ?? 1;
    const expireAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    const serviceName = `تست-${Date.now().toString().slice(-4)}`;
    const remnaUsername = buildUniqueRemnaUsername(user.telegramId, `test-${Date.now().toString().slice(-4)}`);

    const created = await remnawaveService.createUser({
      username: remnaUsername,
      trafficLimitBytes: trafficBytes,
      expireAt,
      telegramId,
    });

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.user.update({
        where: { id: user.id },
        data: { usedTestSubscription: true },
      });

      await tx.service.create({
        data: {
          userId: user.id,
          planId: null,
          name: serviceName,
          remnaUsername,
          remnaUserUuid: created.uuid,
          shortUuid: created.shortUuid ?? null,
          subscriptionUrl: created.subscriptionUrl ?? null,
          trafficLimitBytes: BigInt(trafficBytes),
          expireAt,
          lastKnownUsedBytes: BigInt(0),
          isActive: true,
        },
      });
    });

    return {
      serviceName,
      subscriptionUrl: created.subscriptionUrl ?? '',
    };
  }
}

export const paymentOrchestrator = new PaymentOrchestrator();
```

## src/services/notification.ts
```ts
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
```

## src/commands/common.ts
```ts
import { Keyboard } from 'telegraf';
import type { BotContext } from '../types/context';
import { fa } from '../utils/farsi';

export function mainMenuKeyboard() {
  return Keyboard.keyboard([
    [fa.menu.buy, fa.menu.renew],
    [fa.menu.myServices, fa.menu.test],
    [fa.menu.wallet, fa.menu.invite],
    [fa.menu.support],
  ])
    .resize()
    .persistent();
}

export async function showMainMenu(
  ctx: BotContext,
  text = 'به ربات فروش سرویس خوش آمدید. گزینه مورد نظر را انتخاب کنید.',
): Promise<void> {
  await ctx.reply(text, {
    reply_markup: mainMenuKeyboard().reply_markup,
  });
}
```

## src/commands/start.ts
```ts
import { Markup, Telegraf } from 'telegraf';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { remnawaveService } from '../services/remnawave';
import type { BotContext } from '../types/context';
import { formatTomans } from '../utils/currency';
import { bytesToGb, daysLeft } from '../utils/format';
import { fa } from '../utils/farsi';
import { showMainMenu } from './common';

function extractStartPayload(text: string): string | null {
  const parts = text.trim().split(' ');
  if (parts.length < 2) {
    return null;
  }

  return parts.slice(1).join(' ').trim();
}

function parseReferral(payload: string | null): number | null {
  if (!payload) {
    return null;
  }

  const refMatch = payload.match(/ref[_=](\d+)/);
  if (!refMatch) {
    return null;
  }

  return Number(refMatch[1]);
}

function shouldRequireCaptcha(ctx: BotContext): boolean {
  if (!ctx.from) {
    return false;
  }

  return !ctx.from.username;
}

function createCaptcha(): { question: string; answer: string } {
  const a = Math.floor(Math.random() * 8) + 1;
  const b = Math.floor(Math.random() * 8) + 1;
  return {
    question: `${a} + ${b} = ?`,
    answer: String(a + b),
  };
}

async function showWallet(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(ctx.from.id) },
  });

  if (!user) {
    return;
  }

  await ctx.reply(`موجودی کیف پول شما: ${formatTomans(user.walletBalanceTomans)}`, {
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('شارژ کیف پول', 'wallet_charge')],
    ]).reply_markup,
  });
}

async function showServices(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(ctx.from.id) },
    include: { services: { orderBy: { createdAt: 'desc' } } },
  });

  if (!user || user.services.length === 0) {
    await ctx.reply('شما هنوز سرویسی ندارید.');
    return;
  }

  const lines: string[] = [];

  for (const service of user.services) {
    let usedBytes = service.lastKnownUsedBytes;
    let limitBytes = service.trafficLimitBytes;
    let expireAt = service.expireAt;
    let subscriptionUrl = service.subscriptionUrl;

    try {
      const remote = await remnawaveService.getUserByUsername(service.remnaUsername);
      usedBytes = BigInt(remote.usedTrafficBytes ?? service.lastKnownUsedBytes);
      limitBytes = BigInt(remote.trafficLimitBytes ?? service.trafficLimitBytes);
      expireAt = remote.expireAt ? new Date(remote.expireAt) : service.expireAt;
      subscriptionUrl = remote.subscriptionUrl ?? service.subscriptionUrl;

      await prisma.service.update({
        where: { id: service.id },
        data: {
          lastKnownUsedBytes: usedBytes,
          trafficLimitBytes: limitBytes,
          expireAt,
          subscriptionUrl,
        },
      });
    } catch {
      // If panel read fails, show last saved values.
    }

    const remainBytes = limitBytes > usedBytes ? limitBytes - usedBytes : BigInt(0);

    lines.push(
      [
        `نام: ${service.name}`,
        `حجم باقیمانده: ${Math.floor(bytesToGb(remainBytes))} گیگابایت`,
        `روز باقی مانده: ${Math.max(0, daysLeft(expireAt))}`,
        subscriptionUrl ? `لینک اشتراک: ${subscriptionUrl}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  await ctx.reply(lines.join('\n\n'));
}

export function registerStartHandlers(bot: Telegraf<BotContext>): void {
  bot.start(async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const payload = extractStartPayload(ctx.message?.text ?? '');

    const user = await prisma.user.upsert({
      where: { telegramId: BigInt(ctx.from.id) },
      update: {
        telegramUsername: ctx.from.username ?? null,
        firstName: ctx.from.first_name ?? null,
        lastName: ctx.from.last_name ?? null,
      },
      create: {
        telegramId: BigInt(ctx.from.id),
        telegramUsername: ctx.from.username ?? null,
        firstName: ctx.from.first_name ?? null,
        lastName: ctx.from.last_name ?? null,
      },
    });

    const referralId = parseReferral(payload);
    if (referralId && referralId !== ctx.from.id && !user.referredById) {
      const referrer = await prisma.user.findUnique({
        where: { telegramId: BigInt(referralId) },
        select: { id: true },
      });

      if (referrer) {
        await prisma.user.update({
          where: { id: user.id },
          data: { referredById: referrer.id },
        });
      }
    }

    if (shouldRequireCaptcha(ctx) && !ctx.session.captcha?.verified) {
      const captcha = createCaptcha();
      ctx.session.captcha = {
        answer: captcha.answer,
        verified: false,
      };
      await ctx.reply(`برای تایید هویت عدد را ارسال کنید:\n${captcha.question}`);
      return;
    }

    await showMainMenu(ctx);
  });

  bot.hears(fa.menu.myServices, async (ctx) => {
    await showServices(ctx);
  });

  bot.hears(fa.menu.wallet, async (ctx) => {
    await showWallet(ctx);
  });

  bot.hears(fa.menu.invite, async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const link = `https://t.me/${env.BOT_USERNAME}?start=ref_${ctx.from.id}`;
    await ctx.reply(`لینک دعوت شما:\n${link}`);
  });

  bot.hears(fa.menu.support, async (ctx) => {
    const handle = env.ADMIN_TG_HANDLE.startsWith('@')
      ? env.ADMIN_TG_HANDLE.slice(1)
      : env.ADMIN_TG_HANDLE;

    await ctx.reply('برای پشتیبانی روی دکمه زیر بزنید:', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.url('پشتیبانی', `https://t.me/${handle}`)],
      ]).reply_markup,
    });
  });

  bot.on('text', async (ctx, next) => {
    if (!ctx.session.captcha || ctx.session.captcha.verified) {
      await next();
      return;
    }

    if ((ctx.message.text ?? '').trim() === ctx.session.captcha.answer) {
      ctx.session.captcha.verified = true;
      await showMainMenu(ctx, 'تایید انجام شد.');
      return;
    }

    await ctx.reply('پاسخ اشتباه است. دوباره تلاش کنید.');
  });
}
```

## src/commands/buy.ts
```ts
import { Telegraf } from 'telegraf';
import type { BotContext } from '../types/context';
import { fa } from '../utils/farsi';

export function registerBuyCommands(bot: Telegraf<BotContext>): void {
  bot.hears(fa.menu.buy, async (ctx) => {
    await ctx.scene.enter('buy-wizard');
  });

  bot.command('buy', async (ctx) => {
    await ctx.scene.enter('buy-wizard');
  });
}
```

## src/commands/renew.ts
```ts
import { Telegraf } from 'telegraf';
import type { BotContext } from '../types/context';
import { fa } from '../utils/farsi';

export function registerRenewCommands(bot: Telegraf<BotContext>): void {
  bot.hears(fa.menu.renew, async (ctx) => {
    await ctx.scene.enter('renew-wizard');
  });

  bot.command('renew', async (ctx) => {
    await ctx.scene.enter('renew-wizard');
  });
}
```

## src/commands/admin.ts
```ts
import {
  AffiliateRewardType,
  PaymentGateway,
  PaymentStatus,
  PaymentType,
  WalletTransactionType,
} from '@prisma/client';
import { Markup, Telegraf } from 'telegraf';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { paymentOrchestrator } from '../services/payment-orchestrator';
import { walletService } from '../services/wallet';
import type { BotContext } from '../types/context';
import { formatTomans } from '../utils/currency';

function isAdmin(ctx: BotContext): boolean {
  return Boolean(ctx.from && env.ADMIN_TG_ID_LIST.includes(ctx.from.id));
}

async function ensureAdminUser(ctx: BotContext): Promise<string | null> {
  if (!ctx.from) {
    return null;
  }

  const user = await prisma.user.upsert({
    where: { telegramId: BigInt(ctx.from.id) },
    update: {},
    create: {
      telegramId: BigInt(ctx.from.id),
      firstName: ctx.from.first_name ?? null,
      telegramUsername: ctx.from.username ?? null,
    },
  });

  return user.id;
}

function getArgs(text: string): string[] {
  return text.trim().split(/\s+/).slice(1);
}

function getTextAfterCommand(text: string): string {
  const parts = text.trim().split(' ');
  if (parts.length <= 1) {
    return '';
  }

  return parts.slice(1).join(' ').trim();
}

async function sendStats(ctx: BotContext): Promise<void> {
  const now = new Date();

  const [usersCount, servicesCount, activeSubsCount, pendingManualCount, totalSalesAgg] =
    await Promise.all([
      prisma.user.count(),
      prisma.service.count(),
      prisma.service.count({
        where: {
          isActive: true,
          expireAt: { gt: now },
        },
      }),
      prisma.payment.count({
        where: { status: PaymentStatus.WAITING_REVIEW },
      }),
      prisma.payment.aggregate({
        _sum: { amountTomans: true },
        where: {
          status: PaymentStatus.SUCCESS,
          type: { in: [PaymentType.PURCHASE, PaymentType.RENEWAL] },
        },
      }),
    ]);

  const totalSales = totalSalesAgg._sum.amountTomans ?? 0;

  await ctx.reply(
    [
      `تعداد کاربران: ${usersCount}`,
      `تعداد سرویس ها: ${servicesCount}`,
      `اشتراک فعال: ${activeSubsCount}`,
      `فروش کل: ${formatTomans(totalSales)}`,
      `رسید در انتظار بررسی: ${pendingManualCount}`,
    ].join('\n'),
  );
}

export function registerAdminCommands(bot: Telegraf<BotContext>): void {
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply('این دستور فقط برای ادمین است.');
      return;
    }

    await ctx.reply('پنل ادمین', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('آمار کلی', 'admin_stats')],
        [Markup.button.callback('پرداخت های دستی', 'admin_manuals')],
        [Markup.button.callback('لیست پلن ها', 'admin_plans')],
      ]).reply_markup,
    });

    await ctx.reply(
      [
        'دستورات ادمین:',
        '/stats',
        '/users 20',
        '/services 20',
        '/payments 20',
        '/ban <tg_id>',
        '/unban <tg_id>',
        '/wallet <tg_id> <amount>',
        '/manuals',
        '/broadcast <message>',
        '/plans',
        '/addplan name|trafficGb|durationDays|priceTomans',
        '/editplan id|name|trafficGb|durationDays|priceTomans|active0or1',
        '/delplan <plan_id>',
        '/settest <traffic_gb> <days>',
        '/testtoggle <on|off>',
        '/resettest <tg_id>',
        '/setnotify <days> <gb>',
        '/setaffiliate <fixed|percent> <value>',
        '/promoadd code|percent|fixed|uses',
      ].join('\n'),
    );
  });

  bot.action('admin_stats', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('دسترسی ندارید');
      return;
    }

    await ctx.answerCbQuery();
    await sendStats(ctx);
  });

  bot.command('stats', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    await sendStats(ctx);
  });

  bot.command('users', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const limit = Number(getArgs(ctx.message.text)[0] ?? 20);
    const users = await prisma.user.findMany({
      take: Math.min(Math.max(limit, 1), 100),
      orderBy: { createdAt: 'desc' },
    });

    if (!users.length) {
      await ctx.reply('کاربری یافت نشد.');
      return;
    }

    const lines = users.map(
      (u) =>
        `${u.telegramId.toString()} | بن: ${u.isBanned ? 'بله' : 'خیر'} | کیف پول: ${formatTomans(u.walletBalanceTomans)}`,
    );

    await ctx.reply(lines.join('\n'));
  });

  bot.command('services', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const limit = Number(getArgs(ctx.message.text)[0] ?? 20);
    const services = await prisma.service.findMany({
      take: Math.min(Math.max(limit, 1), 100),
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!services.length) {
      await ctx.reply('سرویسی یافت نشد.');
      return;
    }

    const lines = services.map(
      (s) =>
        `${s.id} | ${s.name} | کاربر: ${s.user.telegramId.toString()} | انقضا: ${s.expireAt.toISOString().slice(0, 10)}`,
    );

    await ctx.reply(lines.join('\n'));
  });

  bot.command('payments', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const limit = Number(getArgs(ctx.message.text)[0] ?? 20);
    const payments = await prisma.payment.findMany({
      take: Math.min(Math.max(limit, 1), 100),
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!payments.length) {
      await ctx.reply('پرداختی یافت نشد.');
      return;
    }

    const lines = payments.map(
      (p) =>
        `${p.id} | ${p.user.telegramId.toString()} | ${p.type} | ${p.gateway} | ${p.status} | ${formatTomans(p.amountTomans)}`,
    );

    await ctx.reply(lines.join('\n'));
  });

  bot.command('ban', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const args = getArgs(ctx.message.text);
    const tgId = Number(args[0]);
    if (!tgId) {
      await ctx.reply('فرمت درست: /ban <tg_id>');
      return;
    }

    await prisma.user.updateMany({
      where: { telegramId: BigInt(tgId) },
      data: { isBanned: true },
    });

    await ctx.reply('کاربر بن شد.');
  });

  bot.command('unban', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const args = getArgs(ctx.message.text);
    const tgId = Number(args[0]);
    if (!tgId) {
      await ctx.reply('فرمت درست: /unban <tg_id>');
      return;
    }

    await prisma.user.updateMany({
      where: { telegramId: BigInt(tgId) },
      data: { isBanned: false },
    });

    await ctx.reply('بن کاربر برداشته شد.');
  });

  bot.command('wallet', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const args = getArgs(ctx.message.text);
    const tgId = Number(args[0]);
    const amount = Number(args[1]);

    if (!tgId || !Number.isInteger(amount) || amount === 0) {
      await ctx.reply('فرمت درست: /wallet <tg_id> <amount> (مثال: +50000 یا -30000)');
      return;
    }

    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(tgId) } });
    if (!user) {
      await ctx.reply('کاربر پیدا نشد.');
      return;
    }

    if (amount > 0) {
      await walletService.credit({
        userId: user.id,
        amountTomans: amount,
        type: WalletTransactionType.ADMIN_ADJUST,
        description: 'تنظیم دستی کیف پول توسط ادمین',
      });
    } else {
      await walletService.debit({
        userId: user.id,
        amountTomans: Math.abs(amount),
        type: WalletTransactionType.ADMIN_ADJUST,
        description: 'کسر دستی کیف پول توسط ادمین',
      });
    }

    await ctx.reply('کیف پول کاربر بروزرسانی شد.');
  });

  bot.command('manuals', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    const pending = await prisma.payment.findMany({
      where: {
        gateway: PaymentGateway.MANUAL,
        status: PaymentStatus.WAITING_REVIEW,
      },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
      take: 30,
    });

    if (!pending.length) {
      await ctx.reply('رسید در انتظار بررسی وجود ندارد.');
      return;
    }

    for (const payment of pending) {
      await ctx.reply(
        `پرداخت: ${payment.id}\nکاربر: ${payment.user.telegramId.toString()}\nمبلغ: ${formatTomans(payment.amountTomans)}`,
        {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('تایید', `manual_approve:${payment.id}`)],
            [Markup.button.callback('رد', `manual_deny:${payment.id}`)],
          ]).reply_markup,
        },
      );
    }
  });

  bot.action('admin_manuals', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('دسترسی ندارید');
      return;
    }

    await ctx.answerCbQuery();
    await ctx.reply('/manuals را اجرا کنید یا از همین لیست پایین استفاده کنید.');
  });

  bot.action('admin_plans', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('دسترسی ندارید');
      return;
    }

    const plans = await prisma.plan.findMany({ orderBy: { createdAt: 'desc' } });
    await ctx.answerCbQuery();

    if (!plans.length) {
      await ctx.reply('پلنی وجود ندارد.');
      return;
    }

    await ctx.reply(
      plans
        .map(
          (p) =>
            `${p.id}\n${p.name} | ${p.trafficGb}GB | ${p.durationDays} روز | ${formatTomans(p.priceTomans)} | فعال: ${p.isActive ? 'بله' : 'خیر'}`,
        )
        .join('\n\n'),
    );
  });

  bot.action(/^manual_approve:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('دسترسی ندارید');
      return;
    }

    const paymentId = ctx.match[1];
    const adminUserId = await ensureAdminUser(ctx);
    if (!adminUserId) {
      await ctx.answerCbQuery('خطا');
      return;
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { user: true },
    });

    if (!payment || payment.status !== PaymentStatus.WAITING_REVIEW) {
      await ctx.answerCbQuery('پرداخت قابل تایید نیست');
      return;
    }

    try {
      await paymentOrchestrator.processSuccessfulPayment(payment.id);
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          reviewedByAdminId: adminUserId,
          reviewNote: 'تایید دستی توسط ادمین',
        },
      });

      await ctx.answerCbQuery('تایید شد');
      await ctx.telegram.sendMessage(
        Number(payment.user.telegramId),
        'پرداخت شما تایید شد و سرویس/کیف پول بروزرسانی شد.',
      );
    } catch (error) {
      logger.error(`manual approve failed paymentId=${payment.id} error=${String(error)}`);
      await ctx.answerCbQuery('خطا در تایید');
      await ctx.reply('خطا در تایید پرداخت. وضعیت پرداخت به ناموفق تغییر کرد.');
      await ctx.telegram.sendMessage(
        Number(payment.user.telegramId),
        'پرداخت شما با خطا مواجه شد. لطفا با پشتیبانی تماس بگیرید.',
      );
    }
  });

  bot.action(/^manual_deny:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('دسترسی ندارید');
      return;
    }

    const paymentId = ctx.match[1];
    const adminUserId = await ensureAdminUser(ctx);
    if (!adminUserId) {
      await ctx.answerCbQuery('خطا');
      return;
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { user: true },
    });

    if (!payment || payment.status !== PaymentStatus.WAITING_REVIEW) {
      await ctx.answerCbQuery('پرداخت قابل رد نیست');
      return;
    }

    await paymentOrchestrator.rejectManualPayment(payment.id, adminUserId, 'رد دستی توسط ادمین');
    await ctx.answerCbQuery('رد شد');
    await ctx.telegram.sendMessage(Number(payment.user.telegramId), 'رسید شما رد شد. با پشتیبانی تماس بگیرید.');
  });

  bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const text = getTextAfterCommand(ctx.message.text);
    if (!text) {
      await ctx.reply('فرمت درست: /broadcast <message>');
      return;
    }

    const users = await prisma.user.findMany({
      where: { isBanned: false },
      select: { telegramId: true },
    });

    let success = 0;
    let failed = 0;

    for (const user of users) {
      try {
        await ctx.telegram.sendMessage(Number(user.telegramId), text);
        success += 1;
      } catch {
        failed += 1;
      }
    }

    await ctx.reply(`ارسال همگانی انجام شد. موفق: ${success} | ناموفق: ${failed}`);
  });

  bot.command('plans', async (ctx) => {
    if (!isAdmin(ctx)) {
      return;
    }

    const plans = await prisma.plan.findMany({ orderBy: { createdAt: 'desc' } });

    if (!plans.length) {
      await ctx.reply('پلنی وجود ندارد.');
      return;
    }

    await ctx.reply(
      plans
        .map(
          (p) =>
            `${p.id}\n${p.name} | ${p.trafficGb}GB | ${p.durationDays} روز | ${formatTomans(p.priceTomans)} | فعال: ${p.isActive ? 'بله' : 'خیر'}`,
        )
        .join('\n\n'),
    );
  });

  bot.command('addplan', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const payload = getTextAfterCommand(ctx.message.text);
    const [name, trafficGbRaw, durationDaysRaw, priceRaw] = payload.split('|').map((x) => x?.trim());

    const trafficGb = Number(trafficGbRaw);
    const durationDays = Number(durationDaysRaw);
    const priceTomans = Number(priceRaw);

    if (!name || !trafficGb || !durationDays || !priceTomans) {
      await ctx.reply('فرمت درست: /addplan name|trafficGb|durationDays|priceTomans');
      return;
    }

    await prisma.plan.create({
      data: {
        name,
        trafficGb,
        durationDays,
        priceTomans,
        isActive: true,
      },
    });

    await ctx.reply('پلن اضافه شد.');
  });

  bot.command('editplan', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const payload = getTextAfterCommand(ctx.message.text);
    const [id, name, trafficGbRaw, durationDaysRaw, priceRaw, activeRaw] = payload
      .split('|')
      .map((x) => x?.trim());

    const trafficGb = Number(trafficGbRaw);
    const durationDays = Number(durationDaysRaw);
    const priceTomans = Number(priceRaw);
    const isActive = activeRaw === '1';

    if (!id || !name || !trafficGb || !durationDays || !priceTomans || !['0', '1'].includes(activeRaw ?? '')) {
      await ctx.reply('فرمت درست: /editplan id|name|trafficGb|durationDays|priceTomans|active0or1');
      return;
    }

    await prisma.plan.update({
      where: { id },
      data: { name, trafficGb, durationDays, priceTomans, isActive },
    });

    await ctx.reply('پلن ویرایش شد.');
  });

  bot.command('delplan', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const id = getArgs(ctx.message.text)[0];
    if (!id) {
      await ctx.reply('فرمت درست: /delplan <plan_id>');
      return;
    }

    await prisma.plan.delete({ where: { id } });
    await ctx.reply('پلن حذف شد.');
  });

  bot.command('settest', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const [trafficGbRaw, daysRaw] = getArgs(ctx.message.text);
    const trafficGb = Number(trafficGbRaw);
    const days = Number(daysRaw);

    if (!trafficGb || !days) {
      await ctx.reply('فرمت درست: /settest <traffic_gb> <days>');
      return;
    }

    await prisma.setting.upsert({
      where: { id: 1 },
      update: {
        testTrafficBytes: BigInt(trafficGb * 1024 * 1024 * 1024),
        testDurationDays: days,
      },
      create: {
        id: 1,
        testTrafficBytes: BigInt(trafficGb * 1024 * 1024 * 1024),
        testDurationDays: days,
      },
    });

    await ctx.reply('تنظیمات سرویس تست بروزرسانی شد.');
  });

  bot.command('testtoggle', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const mode = getArgs(ctx.message.text)[0];
    if (!['on', 'off'].includes(mode ?? '')) {
      await ctx.reply('فرمت درست: /testtoggle <on|off>');
      return;
    }

    await prisma.setting.upsert({
      where: { id: 1 },
      update: { testEnabled: mode === 'on' },
      create: { id: 1, testEnabled: mode === 'on' },
    });

    await ctx.reply(mode === 'on' ? 'سرویس تست فعال شد.' : 'سرویس تست غیرفعال شد.');
  });

  bot.command('resettest', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const tgId = Number(getArgs(ctx.message.text)[0]);
    if (!tgId) {
      await ctx.reply('فرمت درست: /resettest <tg_id>');
      return;
    }

    await prisma.user.updateMany({
      where: { telegramId: BigInt(tgId) },
      data: { usedTestSubscription: false },
    });

    await ctx.reply('وضعیت تست کاربر ریست شد.');
  });

  bot.command('setnotify', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const [daysRaw, gbRaw] = getArgs(ctx.message.text);
    const days = Number(daysRaw);
    const gb = Number(gbRaw);

    if (!days || !gb) {
      await ctx.reply('فرمت درست: /setnotify <days> <gb>');
      return;
    }

    await prisma.setting.upsert({
      where: { id: 1 },
      update: {
        notifyDaysLeft: days,
        notifyGbLeft: gb,
      },
      create: {
        id: 1,
        notifyDaysLeft: days,
        notifyGbLeft: gb,
      },
    });

    await ctx.reply('آستانه اعلان بروزرسانی شد.');
  });

  bot.command('setaffiliate', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const [typeRaw, valueRaw] = getArgs(ctx.message.text);
    const value = Number(valueRaw);

    if (!['fixed', 'percent'].includes(typeRaw ?? '') || !value) {
      await ctx.reply('فرمت درست: /setaffiliate <fixed|percent> <value>');
      return;
    }

    await prisma.setting.upsert({
      where: { id: 1 },
      update: {
        affiliateRewardType: typeRaw === 'fixed' ? AffiliateRewardType.FIXED : AffiliateRewardType.PERCENT,
        affiliateRewardValue: value,
      },
      create: {
        id: 1,
        affiliateRewardType: typeRaw === 'fixed' ? AffiliateRewardType.FIXED : AffiliateRewardType.PERCENT,
        affiliateRewardValue: value,
      },
    });

    await ctx.reply('تنظیمات همکاری فروش بروزرسانی شد.');
  });

  bot.command('promoadd', async (ctx) => {
    if (!isAdmin(ctx) || !ctx.message || !('text' in ctx.message)) {
      return;
    }

    const payload = getTextAfterCommand(ctx.message.text);
    const [codeRaw, percentRaw, fixedRaw, usesRaw] = payload.split('|').map((x) => x?.trim());

    const code = (codeRaw ?? '').toUpperCase();
    const percent = percentRaw ? Number(percentRaw) : 0;
    const fixed = fixedRaw ? Number(fixedRaw) : 0;
    const uses = Number(usesRaw);

    if (!code || (!percent && !fixed) || !uses) {
      await ctx.reply('فرمت درست: /promoadd code|percent|fixed|uses');
      return;
    }

    await prisma.promoCode.create({
      data: {
        code,
        discountPercent: percent || null,
        fixedTomans: fixed || null,
        usesLeft: uses,
        isActive: true,
      },
    });

    await ctx.reply('کد تخفیف ثبت شد.');
  });
}
```

## src/scenes/buy.ts
```ts
import { PaymentGateway } from '@prisma/client';
import { Composer, Markup, Scenes } from 'telegraf';
import { env } from '../config/env';
import { AppError } from '../errors/app-error';
import { prisma } from '../lib/prisma';
import type { BotContext } from '../types/context';
import type { BuyWizardState } from '../types/session';
import { formatTomans } from '../utils/currency';
import { paymentOrchestrator } from '../services/payment-orchestrator';

const scene = new Scenes.WizardScene<BotContext>(
  'buy-wizard',
  async (ctx) => {
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceTomans: 'asc' },
    });

    if (plans.length === 0) {
      await ctx.reply('در حال حاضر پلنی برای فروش فعال نیست.');
      return ctx.scene.leave();
    }

    const buttons = plans.map((plan) =>
      Markup.button.callback(
        `${plan.name} | ${plan.trafficGb}GB | ${plan.durationDays} روز | ${formatTomans(plan.priceTomans)}`,
        `buy_plan:${plan.id}`,
      ),
    );

    await ctx.reply('یک پلن را انتخاب کنید:', {
      reply_markup: Markup.inlineKeyboard(buttons, { columns: 1 }).reply_markup,
    });

    return ctx.wizard.next();
  },
  new Composer<BotContext>()
    .action(/^buy_plan:(.+)$/, async (ctx) => {
      const data = ctx.match[1];
      const plan = await prisma.plan.findUnique({ where: { id: data } });
      if (!plan || !plan.isActive) {
        await ctx.answerCbQuery('پلن نامعتبر است');
        return;
      }

      const state = ctx.wizard.state as BuyWizardState;
      state.planId = plan.id;
      state.planPriceTomans = plan.priceTomans;

      await ctx.answerCbQuery();
      await ctx.reply('نام سرویس دلخواه را ارسال کنید (فقط انگلیسی/عدد، بدون فاصله):');
      return ctx.wizard.next();
    })
    .on('callback_query', async (ctx) => {
      await ctx.answerCbQuery('ابتدا یک پلن را انتخاب کنید');
    }),
  async (ctx) => {
    if (!('text' in ctx.message)) {
      await ctx.reply('لطفا نام سرویس را متنی ارسال کنید.');
      return;
    }

    const raw = ctx.message.text.trim();
    if (!/^[a-zA-Z0-9_-]{3,24}$/.test(raw)) {
      await ctx.reply('نام سرویس نامعتبر است. مثال: myvpn1');
      return;
    }

    const state = ctx.wizard.state as BuyWizardState;
    state.serviceName = raw;

    await ctx.reply('اگر کد تخفیف دارید ارسال کنید. در غیر اینصورت بنویسید: ندارم');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!('text' in ctx.message)) {
      await ctx.reply('متن بفرستید.');
      return;
    }

    const state = ctx.wizard.state as BuyWizardState;
    const text = ctx.message.text.trim();
    state.promoCode = text === 'ندارم' ? undefined : text;

    await ctx.reply(`مبلغ این خرید: ${formatTomans(state.planPriceTomans ?? 0)}`, {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('پرداخت از کیف پول', 'buy_gateway:wallet')],
        [Markup.button.callback('پرداخت آنلاین تترا98', 'buy_gateway:tetra')],
        [Markup.button.callback('پرداخت کارت به کارت', 'buy_gateway:manual')],
      ]).reply_markup,
    });

    return ctx.wizard.next();
  },
  new Composer<BotContext>()
    .action(/^buy_gateway:(wallet|tetra|manual)$/, async (ctx) => {
      if (!ctx.from) {
        return;
      }

      const state = ctx.wizard.state as BuyWizardState;
      if (!state.planId || !state.serviceName) {
        await ctx.answerCbQuery('اطلاعات خرید ناقص است');
        return ctx.scene.leave();
      }

      const gatewayMap: Record<string, PaymentGateway> = {
        wallet: PaymentGateway.WALLET,
        tetra: PaymentGateway.TETRA98,
        manual: PaymentGateway.MANUAL,
      };

      const selected = ctx.match[1];
      const gateway = gatewayMap[selected];

      try {
        const payment = await paymentOrchestrator.createPurchasePayment({
          telegramId: ctx.from.id,
          planId: state.planId,
          serviceName: state.serviceName,
          gateway,
          promoCode: state.promoCode,
        });

        if (gateway === PaymentGateway.WALLET) {
          await ctx.answerCbQuery();
          await ctx.reply('خرید با موفقیت انجام شد و سرویس شما فعال شد.');
          return ctx.scene.leave();
        }

        if (gateway === PaymentGateway.TETRA98) {
          const order = await paymentOrchestrator.createTetra98Order(payment.id);
          await ctx.answerCbQuery();
          await ctx.reply(`برای پرداخت روی لینک زیر بزنید:\n${order.link}`);
          return ctx.scene.leave();
        }

        const setting = await prisma.setting.findUnique({ where: { id: 1 } });
        const cardNumber = setting?.manualCardNumber ?? env.MANUAL_CARD_NUMBER;
        ctx.session.pendingManualPaymentId = payment.id;
        await ctx.answerCbQuery();
        await ctx.reply(
          `لطفا مبلغ ${formatTomans(payment.amountTomans)} را به کارت ${cardNumber} واریز کنید و عکس رسید را ارسال کنید.`,
        );
        return ctx.wizard.next();
      } catch (error) {
        const message =
          error instanceof AppError ? error.message : 'خطا در ایجاد پرداخت. لطفا دوباره تلاش کنید.';
        await ctx.answerCbQuery();
        await ctx.reply(message);
        return ctx.scene.leave();
      }
    })
    .on('callback_query', async (ctx) => {
      await ctx.answerCbQuery('روش پرداخت را انتخاب کنید');
    }),
  async (ctx) => {
    const paymentId = ctx.session.pendingManualPaymentId;

    if (!paymentId) {
      await ctx.reply('درخواست پرداخت دستی یافت نشد.');
      return ctx.scene.leave();
    }

    if (!('photo' in ctx.message) || !ctx.message.photo.length) {
      await ctx.reply('لطفا عکس رسید را ارسال کنید.');
      return;
    }

    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    await paymentOrchestrator.submitManualReceipt(paymentId, fileId);

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { user: true },
    });

    if (payment) {
      for (const adminId of env.ADMIN_TG_ID_LIST) {
        await ctx.telegram.sendPhoto(adminId, fileId, {
          caption: `رسید جدید ثبت شد\nپرداخت: ${payment.id}\nکاربر: ${payment.user.telegramId.toString()}\nمبلغ: ${formatTomans(payment.amountTomans)}`,
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('تایید', `manual_approve:${payment.id}`)],
            [Markup.button.callback('رد', `manual_deny:${payment.id}`)],
          ]).reply_markup,
        });
      }
    }

    ctx.session.pendingManualPaymentId = undefined;
    await ctx.reply('رسید شما ثبت شد. پس از بررسی ادمین اطلاع رسانی می شود.');
    return ctx.scene.leave();
  },
);

export const buyWizardScene = scene;
```

## src/scenes/renew.ts
```ts
import { PaymentGateway } from '@prisma/client';
import { Composer, Markup, Scenes } from 'telegraf';
import { env } from '../config/env';
import { AppError } from '../errors/app-error';
import { prisma } from '../lib/prisma';
import { paymentOrchestrator } from '../services/payment-orchestrator';
import type { BotContext } from '../types/context';
import type { RenewWizardState } from '../types/session';
import { formatTomans } from '../utils/currency';

const scene = new Scenes.WizardScene<BotContext>(
  'renew-wizard',
  async (ctx) => {
    if (!ctx.from) {
      return ctx.scene.leave();
    }

    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(ctx.from.id) },
      include: {
        services: {
          where: { isActive: true },
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user || user.services.length === 0) {
      await ctx.reply('شما سرویس فعالی برای تمدید ندارید.');
      return ctx.scene.leave();
    }

    const buttons = user.services
      .filter((service) => Boolean(service.plan))
      .map((service) =>
        Markup.button.callback(
          `${service.name} | ${formatTomans(service.plan!.priceTomans)}`,
          `renew_service:${service.id}`,
        ),
      );

    if (buttons.length === 0) {
      await ctx.reply('برای سرویس های تست امکان تمدید وجود ندارد.');
      return ctx.scene.leave();
    }

    await ctx.reply('سرویس مورد نظر برای تمدید را انتخاب کنید:', {
      reply_markup: Markup.inlineKeyboard(buttons, { columns: 1 }).reply_markup,
    });

    return ctx.wizard.next();
  },
  new Composer<BotContext>()
    .action(/^renew_service:(.+)$/, async (ctx) => {
      const serviceId = ctx.match[1];
      const service = await prisma.service.findUnique({
        where: { id: serviceId },
        include: { plan: true },
      });

      if (!service || !service.plan) {
        await ctx.answerCbQuery('سرویس نامعتبر است');
        return;
      }

      const state = ctx.wizard.state as RenewWizardState;
      state.serviceId = service.id;
      state.planId = service.plan.id;
      state.planPriceTomans = service.plan.priceTomans;

      await ctx.answerCbQuery();
      await ctx.reply('اگر کد تخفیف دارید ارسال کنید. در غیر اینصورت بنویسید: ندارم');
      return ctx.wizard.next();
    })
    .on('callback_query', async (ctx) => {
      await ctx.answerCbQuery('ابتدا سرویس را انتخاب کنید');
    }),
  async (ctx) => {
    if (!('text' in ctx.message)) {
      await ctx.reply('لطفا متن ارسال کنید.');
      return;
    }

    const state = ctx.wizard.state as RenewWizardState;
    const promo = ctx.message.text.trim();
    state.promoCode = promo === 'ندارم' ? undefined : promo;

    await ctx.reply(`مبلغ تمدید: ${formatTomans(state.planPriceTomans ?? 0)}`, {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('پرداخت از کیف پول', 'renew_gateway:wallet')],
        [Markup.button.callback('پرداخت آنلاین تترا98', 'renew_gateway:tetra')],
        [Markup.button.callback('پرداخت کارت به کارت', 'renew_gateway:manual')],
      ]).reply_markup,
    });

    return ctx.wizard.next();
  },
  new Composer<BotContext>()
    .action(/^renew_gateway:(wallet|tetra|manual)$/, async (ctx) => {
      if (!ctx.from) {
        return;
      }

      const state = ctx.wizard.state as RenewWizardState;
      if (!state.serviceId) {
        await ctx.answerCbQuery('اطلاعات تمدید ناقص است');
        return ctx.scene.leave();
      }

      const gatewayMap: Record<string, PaymentGateway> = {
        wallet: PaymentGateway.WALLET,
        tetra: PaymentGateway.TETRA98,
        manual: PaymentGateway.MANUAL,
      };

      const gateway = gatewayMap[ctx.match[1]];

      try {
        const payment = await paymentOrchestrator.createRenewPayment({
          telegramId: ctx.from.id,
          serviceId: state.serviceId,
          gateway,
          promoCode: state.promoCode,
        });

        if (gateway === PaymentGateway.WALLET) {
          await ctx.answerCbQuery();
          await ctx.reply('تمدید با موفقیت انجام شد.');
          return ctx.scene.leave();
        }

        if (gateway === PaymentGateway.TETRA98) {
          const order = await paymentOrchestrator.createTetra98Order(payment.id);
          await ctx.answerCbQuery();
          await ctx.reply(`برای پرداخت روی لینک زیر بزنید:\n${order.link}`);
          return ctx.scene.leave();
        }

        const setting = await prisma.setting.findUnique({ where: { id: 1 } });
        const cardNumber = setting?.manualCardNumber ?? env.MANUAL_CARD_NUMBER;
        ctx.session.pendingManualPaymentId = payment.id;
        await ctx.answerCbQuery();
        await ctx.reply(
          `لطفا مبلغ ${formatTomans(payment.amountTomans)} را به کارت ${cardNumber} واریز کنید و عکس رسید را ارسال کنید.`,
        );
        return ctx.wizard.next();
      } catch (error) {
        const message =
          error instanceof AppError ? error.message : 'خطا در ایجاد پرداخت. لطفا دوباره تلاش کنید.';
        await ctx.answerCbQuery();
        await ctx.reply(message);
        return ctx.scene.leave();
      }
    })
    .on('callback_query', async (ctx) => {
      await ctx.answerCbQuery('روش پرداخت را انتخاب کنید');
    }),
  async (ctx) => {
    const paymentId = ctx.session.pendingManualPaymentId;

    if (!paymentId) {
      await ctx.reply('درخواست پرداخت دستی یافت نشد.');
      return ctx.scene.leave();
    }

    if (!('photo' in ctx.message) || !ctx.message.photo.length) {
      await ctx.reply('لطفا عکس رسید را ارسال کنید.');
      return;
    }

    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    await paymentOrchestrator.submitManualReceipt(paymentId, fileId);

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { user: true },
    });

    if (payment) {
      for (const adminId of env.ADMIN_TG_ID_LIST) {
        await ctx.telegram.sendPhoto(adminId, fileId, {
          caption: `رسید تمدید ثبت شد\nپرداخت: ${payment.id}\nکاربر: ${payment.user.telegramId.toString()}\nمبلغ: ${formatTomans(payment.amountTomans)}`,
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('تایید', `manual_approve:${payment.id}`)],
            [Markup.button.callback('رد', `manual_deny:${payment.id}`)],
          ]).reply_markup,
        });
      }
    }

    ctx.session.pendingManualPaymentId = undefined;
    await ctx.reply('رسید شما ثبت شد. پس از بررسی ادمین اطلاع رسانی می شود.');
    return ctx.scene.leave();
  },
);

export const renewWizardScene = scene;
```

## src/scenes/wallet-charge.ts
```ts
import { PaymentGateway } from '@prisma/client';
import { Composer, Markup, Scenes } from 'telegraf';
import { env } from '../config/env';
import { AppError } from '../errors/app-error';
import { prisma } from '../lib/prisma';
import { paymentOrchestrator } from '../services/payment-orchestrator';
import type { BotContext } from '../types/context';
import type { WalletWizardState } from '../types/session';
import { formatTomans } from '../utils/currency';

const scene = new Scenes.WizardScene<BotContext>(
  'wallet-charge-wizard',
  async (ctx) => {
    await ctx.reply(
      `مبلغ شارژ را به تومان وارد کنید. حداقل ${formatTomans(env.MIN_WALLET_CHARGE_TOMANS)} و حداکثر ${formatTomans(env.MAX_WALLET_CHARGE_TOMANS)}`,
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!('text' in ctx.message)) {
      await ctx.reply('مبلغ را به صورت عدد ارسال کنید.');
      return;
    }

    const amount = Number(ctx.message.text.replace(/,/g, '').trim());

    if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
      await ctx.reply('مبلغ وارد شده معتبر نیست.');
      return;
    }

    if (amount < env.MIN_WALLET_CHARGE_TOMANS || amount > env.MAX_WALLET_CHARGE_TOMANS) {
      await ctx.reply('مبلغ خارج از بازه مجاز است.');
      return;
    }

    const state = ctx.wizard.state as WalletWizardState;
    state.amountTomans = amount;

    await ctx.reply(`مبلغ ${formatTomans(amount)} برای شارژ کیف پول تایید شد. روش پرداخت را انتخاب کنید:`, {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('پرداخت آنلاین تترا98', 'wallet_gateway:tetra')],
        [Markup.button.callback('پرداخت کارت به کارت', 'wallet_gateway:manual')],
      ]).reply_markup,
    });

    return ctx.wizard.next();
  },
  new Composer<BotContext>()
    .action(/^wallet_gateway:(tetra|manual)$/, async (ctx) => {
      if (!ctx.from) {
        return;
      }

      const state = ctx.wizard.state as WalletWizardState;
      if (!state.amountTomans) {
        await ctx.answerCbQuery('اطلاعات پرداخت ناقص است');
        return ctx.scene.leave();
      }

      const gateway = ctx.match[1] === 'tetra' ? PaymentGateway.TETRA98 : PaymentGateway.MANUAL;

      try {
        const payment = await paymentOrchestrator.createWalletChargePayment({
          telegramId: ctx.from.id,
          amountTomans: state.amountTomans,
          gateway,
        });

        if (gateway === PaymentGateway.TETRA98) {
          const order = await paymentOrchestrator.createTetra98Order(payment.id);
          await ctx.answerCbQuery();
          await ctx.reply(`برای پرداخت روی لینک زیر بزنید:\n${order.link}`);
          return ctx.scene.leave();
        }

        const setting = await prisma.setting.findUnique({ where: { id: 1 } });
        const cardNumber = setting?.manualCardNumber ?? env.MANUAL_CARD_NUMBER;
        ctx.session.pendingManualPaymentId = payment.id;
        await ctx.answerCbQuery();
        await ctx.reply(
          `لطفا مبلغ ${formatTomans(payment.amountTomans)} را به کارت ${cardNumber} واریز کنید و عکس رسید را ارسال کنید.`,
        );
        return ctx.wizard.next();
      } catch (error) {
        const message =
          error instanceof AppError ? error.message : 'خطا در ایجاد پرداخت. لطفا دوباره تلاش کنید.';
        await ctx.answerCbQuery();
        await ctx.reply(message);
        return ctx.scene.leave();
      }
    })
    .on('callback_query', async (ctx) => {
      await ctx.answerCbQuery('روش پرداخت را انتخاب کنید');
    }),
  async (ctx) => {
    const paymentId = ctx.session.pendingManualPaymentId;

    if (!paymentId) {
      await ctx.reply('درخواست پرداخت دستی یافت نشد.');
      return ctx.scene.leave();
    }

    if (!('photo' in ctx.message) || !ctx.message.photo.length) {
      await ctx.reply('لطفا عکس رسید را ارسال کنید.');
      return;
    }

    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    await paymentOrchestrator.submitManualReceipt(paymentId, fileId);

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { user: true },
    });

    if (payment) {
      for (const adminId of env.ADMIN_TG_ID_LIST) {
        await ctx.telegram.sendPhoto(adminId, fileId, {
          caption: `رسید شارژ کیف پول ثبت شد\nپرداخت: ${payment.id}\nکاربر: ${payment.user.telegramId.toString()}\nمبلغ: ${formatTomans(payment.amountTomans)}`,
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('تایید', `manual_approve:${payment.id}`)],
            [Markup.button.callback('رد', `manual_deny:${payment.id}`)],
          ]).reply_markup,
        });
      }
    }

    ctx.session.pendingManualPaymentId = undefined;
    await ctx.reply('رسید شما ثبت شد. پس از بررسی ادمین اطلاع رسانی می شود.');
    return ctx.scene.leave();
  },
);

export const walletChargeWizardScene = scene;
```

## README.md
```md
# Remnawave VPN Telegram Bot

ربات فروش VPN با TypeScript + Telegraf + Prisma + PostgreSQL، با پنل Remnawave و درگاه Tetra98.

## امکانات

- خرید پلن های پویا
- چند سرویس برای هر کاربر
- تمدید سرویس
- سرویس تست یک بار (قابل ریست)
- کیف پول + شارژ با Tetra98
- پرداخت کارت به کارت + رسید عکس + تایید ادمین
- کد تخفیف
- همکاری فروش (referral)
- اعلان روزانه کاهش حجم/روز
- پنل ادمین کامل
- webhook تلگرام + callback درگاه

## ساختار

```text
src/
  app.ts
  bot.ts
  commands/
  scenes/
  services/
  middlewares/
  utils/
  config/
  lib/
  types/
prisma/
  schema.prisma
  seed.ts
  migrations/
scripts/backup-db.sh
```

## ساخت ربات در BotFather

1. به `@BotFather` بروید.
2. `/newbot` را اجرا کنید.
3. `BOT_TOKEN` را بردارید.
4. username ربات را در `BOT_USERNAME` قرار دهید.

## راه اندازی Ubuntu VPS

### 1) نصب پیش نیازها

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential ca-certificates gnupg
```

### 2) نصب Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
corepack enable
node -v
npm -v
```

### 3) نصب PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

### 4) ساخت DB و User

```bash
sudo -u postgres psql
```

```sql
CREATE USER vpn_bot WITH PASSWORD 'change_this_password';
CREATE DATABASE vpn_bot OWNER vpn_bot;
GRANT ALL PRIVILEGES ON DATABASE vpn_bot TO vpn_bot;
\q
```

### 5) دریافت پروژه

```bash
git clone <YOUR_REPO_URL> remnawave-vpn-bot
cd remnawave-vpn-bot
cp .env.example .env
pnpm install
```

### 6) تنظیم ENV

مقادیر ضروری:

- `APP_URL` مثل `https://bot.example.com`
- `WEBHOOK_PATH` مثل `/telegram/webhook`
- `BOT_TOKEN`
- `BOT_USERNAME`
- `ADMIN_TG_IDS`
- `ADMIN_TG_HANDLE`
- `DATABASE_URL`
- `REMNAWAVE_URL`
- `REMNAWAVE_TOKEN`
- `TETRA98_API_KEY`
- `MANUAL_CARD_NUMBER`

### 7) Migration و Seed

```bash
pnpm prisma:generate
pnpm prisma:deploy
pnpm db:seed
```

### 8) Build و Run با PM2

```bash
pnpm build
pnpm add -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## Webhook

- Telegram webhook: `${APP_URL}${WEBHOOK_PATH}`
- Tetra98 callback: `${APP_URL}/callback/tetra98`

برای تست لوکال:

```bash
ngrok http 3000
```

سپس `APP_URL` را روی آدرس ngrok بگذارید.

## تنظیم Tetra98

- `TETRA98_API_KEY` را در `.env` قرار دهید.
- callback را روی `https://your-domain.com/callback/tetra98` تنظیم کنید.

جریان:

1. `create_order`
2. لینک `https://t.me/Tetra98_bot?start=pay_{Authority}`
3. callback
4. `verify`
5. تکمیل خرید/تمدید/شارژ

## دستورات ادمین

- `/admin`
- `/stats`
- `/users 20`
- `/services 20`
- `/payments 20`
- `/ban <tg_id>`
- `/unban <tg_id>`
- `/wallet <tg_id> <amount>`
- `/manuals`
- `/broadcast <message>`
- `/plans`
- `/addplan name|trafficGb|durationDays|priceTomans`
- `/editplan id|name|trafficGb|durationDays|priceTomans|active0or1`
- `/delplan <plan_id>`
- `/settest <traffic_gb> <days>`
- `/testtoggle <on|off>`
- `/resettest <tg_id>`
- `/setnotify <days> <gb>`
- `/setaffiliate <fixed|percent> <value>`
- `/promoadd code|percent|fixed|uses`

## بکاپ دیتابیس با Cron

```bash
bash scripts/backup-db.sh
```

نمونه کران روزانه 03:00:

```cron
0 3 * * * cd /path/to/remnawave-vpn-bot && DATABASE_URL="postgresql://vpn_bot:change_this_password@localhost:5432/vpn_bot?schema=public" bash scripts/backup-db.sh >> backups/cron.log 2>&1
```

## Docker (اختیاری)

```bash
docker compose up -d --build
docker compose exec app pnpm prisma:deploy
docker compose exec app pnpm db:seed
```

## Scripts

```bash
pnpm dev
pnpm build
pnpm start
pnpm lint
pnpm format
pnpm prisma:generate
pnpm prisma:deploy
pnpm db:seed
pnpm backup:db
```
```

