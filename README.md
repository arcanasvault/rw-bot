# Remnawave VPN Telegram Bot

ربات فروش VPN با TypeScript + Telegraf + Prisma + PostgreSQL برای بازار ایران، با پنل RemnaWave و درگاه Tetra98.

## قابلیت‌ها

- خرید پلن پویا
- داشتن چند سرویس مستقل برای هر کاربر
- تمدید سرویس
- سرویس تست یک‌بار در طول عمر هر Telegram ID
- کیف پول + شارژ با Tetra98
- پرداخت کارت‌به‌کارت + ثبت رسید عکس + تایید/رد ادمین
- خروج خودکار از سناریوها (Wizard Opt-Out) با هر دکمه/دستور جدید
- منوی «سرویس‌های من» با دکمه‌های لینک هوشمند، لینک اضطراری، QR و بازگشت
- اعلان روزانه کاهش حجم/انقضا در ساعت 16:00 تهران
- پنل ادمین
- حالت Webhook

## پیش‌نیازهای Ubuntu VPS

- Ubuntu 22.04 یا 24.04
- دسترسی `sudo`
- `git`
- دامنه HTTPS (برای webhook)

## ساخت ربات تلگرام (BotFather)

1. به `@BotFather` پیام بدهید و دستور `/newbot` را اجرا کنید.
2. نام ربات و سپس username را وارد کنید.
3. توکن ربات را دریافت کنید و برای `BOT_TOKEN` نگه دارید.
4. username ربات (بدون `@`) را برای `BOT_USERNAME` نگه دارید.

## نصب و راه‌اندازی سریع با Docker (پیشنهادی)

```bash
git clone https://github.com/arcanasvault/rw-bot
cd remnawave-vpn-bot
chmod +x setup.sh
./setup.sh
```

پس از اجرای اسکریپت، گزینه `1) Install / Setup` را بزنید.

## منوی `setup.sh`

1. Install / Setup
2. Start / Restart
3. Stop
4. Update (git pull + rebuild)
5. Logs
6. Backup DB
7. Restore DB
8. Uninstall (remove containers + volumes)
9. Reset Database Completely
10. Setup NGINX + Certbot (optional)
0. Exit

### Install / Setup چه می‌کند؟

- Docker و Docker Compose plugin را در صورت نیاز نصب می‌کند.
- فایل `.env` را از `.env.example` می‌سازد.
- مقادیر ضروری را تعاملی می‌گیرد.
- مجوز `.env` را روی `700` می‌گذارد.
- کانتینرهای `app` و `db` را build/up می‌کند.
- `prisma generate` و `prisma migrate deploy` اجرا می‌کند.
- در صورت `RUN_SEED=true`، seed اجرا می‌شود.
- راهنمای Nginx برای reverse proxy نمایش می‌دهد.
- webhook را به صورت خودکار روی Telegram تنظیم می‌کند.
- `getWebhookInfo` را بررسی می‌کند و خطاهای SSL/404 را نمایش می‌دهد.

## تنظیم دامنه و Webhook

- آدرس webhook:

```text
${APP_URL}${WEBHOOK_PATH}
```

- callback درگاه Tetra98:

```text
${APP_URL}/callback/tetra98
```

## نصب روی همان سرور پنل RemnaWave

در این سناریو پنل RemnaWave از قبل روی همان Ubuntu VPS فعال است (پنل روی `127.0.0.1:3000` و NGINX هاست هم در حال پروکسی کردن است).

1. پیش‌نیاز و آماده‌سازی پروژه:
   - پروژه ربات را clone کنید و وارد پوشه شوید:
   ```bash
   git clone https://github.com/arcanasvault/rw-bot
   cd remnawave-vpn-bot
   ```
   - فایل env را بسازید:
   ```bash
   cp .env.example .env
   ```

2. دیتابیس جدا برای ربات:
   - حتما برای ربات PostgreSQL Database/User مستقل بسازید.
   - از دیتابیس پنل RemnaWave برای ربات استفاده نکنید.

3. اتصال ربات به پنل محلی RemnaWave:
   - در `.env` مقدار `REMNAWAVE_URL` را روی آدرس داخلی پنل بگذارید:
     - `REMNAWAVE_URL=http://127.0.0.1:3000`
     - یا `REMNAWAVE_URL=http://localhost:3000`

4. تنظیم پورت ربات روی همان VPS:
   - چون پورت `3000` معمولا توسط پنل اشغال است، برای ربات پورت `4000` پیشنهاد می‌شود.
   - `setup.sh` اگر اشغال بودن `3000` را تشخیص دهد، به صورت خودکار `4000` را به عنوان پیش‌فرض `APP_PORT` پیشنهاد می‌دهد.
   - در صورت نیاز می‌توانید پورت دیگری وارد کنید.

5. تنظیم NGINX برای ساب‌دامین ربات:
   - یک ساب‌دامین جدا مثل `bot.domain.com` برای webhook ربات تنظیم کنید.
   - روی NGINX هاست یک server block جدا برای ربات اضافه کنید تا به پورت ربات (مثلا `4000`) پروکسی شود:
   ```nginx
   server {
       listen 80;
       server_name bot.domain.com;

       location / {
           proxy_pass http://127.0.0.1:4000;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```
   - اگر گواهی دامنه bot از قبل دارید، همان را استفاده کنید.
   - اگر ندارید، گواهی جدید بگیرید:
   ```bash
   certbot --nginx -d bot.domain.com
   ```

6. اجرای نصب با اسکریپت:
   - اسکریپت را اجرا کنید:
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```
   - گزینه `1) Install / Setup` را بزنید.
   - هنگام Prompt ها:
     - `REMNAWAVE_URL` را `http://127.0.0.1:3000` بگذارید.
     - `APP_URL` را دامنه HTTPS ربات بگذارید (مثلا `https://bot.domain.com`).
     - `WEBHOOK_PATH` را مقدار پیش‌فرض `/telegram/webhook` نگه دارید مگر اینکه عمدا تغییر داده باشید.
     - برای `APP_PORT` اگر `3000` اشغال است، مقدار پیشنهادی `4000` را قبول کنید.

7. بررسی بعد از نصب:
   - وضعیت webhook را چک کنید:
   ```bash
   curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
   ```
   - تست عملکرد:
     - در تلگرام `/start` بفرستید.
     - لاگ‌ها را از `setup.sh` گزینه `5` ببینید.

8. عیب‌یابی سریع:
   - تداخل پورت: اگر app بالا نیامد، یک پورت آزاد دیگر برای `APP_PORT` انتخاب کنید و دوباره `Start / Restart` بزنید.
   - NGINX: بعد از تغییر کانفیگ:
   ```bash
   nginx -t && nginx -s reload
   ```
   - فایروال: اگر همان الگوی فعلی NGINX را استفاده می‌کنید، معمولا قانون جدید UFW لازم نیست.

## متغیرهای محیطی `.env`

کلیدی‌ترین موارد:

- `NODE_ENV=production`
- `APP_URL=https://your-domain.com`
- `WEBHOOK_PATH=/telegram/webhook`
- `WEBHOOK_SET_RETRIES=3`
- `BOT_TOKEN=...`
- `BOT_USERNAME=...`
- `ADMIN_TG_IDS=111111111,222222222`
- `ADMIN_TG_HANDLE=your_support_id`
- `DATABASE_URL=postgresql://...`
- `REMNAWAVE_URL=https://your-panel.com/api` (یا بدون `/api`)
- `REMNAWAVE_TOKEN=...`
- `TETRA98_API_KEY=...`
- `MANUAL_CARD_NUMBER=...`
- `DEFAULT_INTERNAL_SQUAD_ID=1`
- `MIN_WALLET_CHARGE_TOMANS=10000`
- `MAX_WALLET_CHARGE_TOMANS=10000000`
- `ENABLE_NGINX=true|false`
- `DOMAIN=your-domain.com`
- `LETSENCRYPT_EMAIL=you@example.com`

## اجرای سرویس‌ها با Docker Compose

- `db`: PostgreSQL 16 (persistent volume)
- `app`: Bot + Express webhook server
- `nginx`: پروفایل اختیاری `nginx` برای SSL/TLS و reverse proxy
- کران پاک‌سازی خودکار:
  - هر روز ساعت 03:00 تهران: حذف سرویس‌های تست منقضی شده
  - هر روز ساعت 04:00 تهران: حذف سرویس‌های غیرتست که بیش از 7 روز از انقضایشان گذشته

## دیباگ /start و Webhook

- اگر `/start` پاسخ نداد:
  - ابتدا لاگ `app` را ببینید (`setup.sh` گزینه 5).
  - مقدار `BOT_TOKEN` و `BOT_USERNAME` را بررسی کنید.
  - بررسی کنید کاربر ban نشده باشد.
  - به خاطر burst protection، ارسال پشت‌سرهم `/start` برای چند ثانیه محدود می‌شود.

- اگر webhook مشکل داشت:
  - از گزینه `1` یا `10` در `setup.sh` برای setWebhook/getWebhookInfo استفاده کنید.
  - `APP_URL` باید HTTPS معتبر داشته باشد.
  - پورت URL باید یکی از `443/80/88/8443` باشد.
  - مسیر `WEBHOOK_PATH` باید دقیقا با مسیر route یکی باشد.
  - خطاهای `certificate verify failed` یا `404` در لاگ ثبت می‌شوند.

## رفتار سناریوها (Opt-Out)

- اگر کاربر داخل Wizard باشد (مثلا خرید) و دکمه دیگری بزند یا دستور جدید بفرستد، سناریو به صورت خودکار لغو می‌شود.
- ورودی جدید همان لحظه مثل حالت عادی پردازش می‌شود (مثلا رفتن به منوی اصلی یا سرویس‌ها).

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
- `/addplan`
- `/editplan`
- `/delplan <plan_id>`
- `/settest <traffic_gb> <days>`
- `/settestinternalsquad <id(s)>`
- `/testtoggle <on|off>`
- `/resettest <tg_id>`
- `/resetalltests`
- `/togglemanual`
- `/toggletetra`
- `/setnotify <days> <gb>`

## مانیتورینگ و عملیات

- لاگ:

```bash
./setup.sh
# گزینه 5
```

- بکاپ دیتابیس:

```bash
./setup.sh
# گزینه 6
```

- ریستور دیتابیس:

```bash
./setup.sh
# گزینه 7
```

- آپدیت:

```bash
./setup.sh
# گزینه 4
```

## اجرای PM2 (اختیاری، حالت بدون Docker)

```bash
pnpm install
pnpm prisma:generate
pnpm prisma:deploy
pnpm build
pnpm add -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## اجرای محلی بدون Docker (اختیاری)

```bash
pnpm install
pnpm prisma:generate
pnpm prisma:deploy
pnpm db:seed
pnpm dev
```

## اسکریپت‌های مفید

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
