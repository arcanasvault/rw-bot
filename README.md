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
