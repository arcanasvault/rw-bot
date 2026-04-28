# AGENTS.md

## Project Overview

`remnawave-vpn-telegram-bot` is a Telegram sales bot for provisioning and managing VPN subscriptions backed by a RemnaWave panel. It is designed for an Iranian market workflow and supports:

- New subscription purchases
- Service renewal
- One-time free test subscriptions
- Wallet top-ups and wallet-based checkout
- Tetra98 online payments
- Manual card-to-card payments with receipt review
- Admin plan management, promo codes, sales controls, and reporting
- Daily user notifications and automatic cleanup of expired services

### Tech Stack

| Area | Technology |
| --- | --- |
| Runtime | Node.js 20 |
| Language | TypeScript |
| Bot framework | Telegraf |
| Persistence | PostgreSQL + Prisma ORM |
| External VPN panel | RemnaWave API (`@remnawave/backend-contract`) |
| Payment gateway | Tetra98 |
| Background jobs | `node-cron` |
| QR generation | `qr-code-styling` + `sharp` + `jsdom` |
| Logging | Winston |
| Deployment | Docker Compose, optional PM2 |

## Main Purpose

The bot is the commercial and operational layer in front of a RemnaWave panel:

- Telegram is the user interface.
- Prisma/PostgreSQL is the source of truth for users, plans, services, payments, wallet transactions, settings, and promos.
- RemnaWave is the source of truth for actual VPN account provisioning, renewal, usage, expiry, and subscription data.
- Payment orchestration coordinates local DB state, wallet debits/credits, external gateway orders, manual review, and final service delivery.

## Runtime Model

The current implementation runs in **long polling** mode via `bot.launch()` in [src/app.ts](/home/personal/rwbot/src/app.ts), not via Telegram webhook handling. The HTTP server in the same file exists for:

- `GET /health`
- `POST /callback/tetra98`

This matters for contributors because older docs and setup flows mention webhook support, but the current codebase does not expose a Telegram webhook endpoint.

## High-Level Architecture

## Repository Structure

| Path | Purpose |
| --- | --- |
| `src/app.ts` | Process bootstrap, HTTP server, cron startup, long polling launch, shutdown handling |
| `src/bot.ts` | Telegraf bot construction, middleware, sessions, scenes, command registration |
| `src/commands/` | Stateless command and button entry points |
| `src/scenes/` | Wizard-style multi-step flows for buy, renew, wallet charge, and admin data entry |
| `src/services/` | Business logic and external integrations |
| `src/lib/` | Shared infrastructure (`prisma`, `logger`) |
| `src/config/` | Environment parsing and QR styling |
| `src/utils/` | Formatting, currency, Farsi labels, RemnaWave squad parsing |
| `src/middlewares/` | User bootstrap and admin gating helpers |
| `src/types/` | Telegraf context/session typing |
| `prisma/schema.prisma` | Full data model |
| `prisma/migrations/` | Database evolution history |
| `prisma/seed.ts` | Initial setting, plan, and admin bootstrap |
| `docker-compose.yml`, `Dockerfile`, `docker/entrypoint.sh` | Containerized runtime |
| `setup.sh` | Interactive installation/operations script |

## Architectural Layers

### 1. Bot Interface Layer

Files:

- [src/bot.ts](/home/personal/rwbot/src/bot.ts)
- [src/commands/start.ts](/home/personal/rwbot/src/commands/start.ts)
- [src/commands/buy.ts](/home/personal/rwbot/src/commands/buy.ts)
- [src/commands/renew.ts](/home/personal/rwbot/src/commands/renew.ts)
- [src/commands/admin.ts](/home/personal/rwbot/src/commands/admin.ts)

Responsibilities:

- Register commands and `hears()` handlers
- Define global rate limiting
- Initialize Telegraf session storage
- Register wizard scenes
- Implement scene opt-out/reset behavior
- Expose user actions such as buy, renew, wallet, support, test, and admin commands

### 2. Scene Layer

Files:

- [src/scenes/buy.ts](/home/personal/rwbot/src/scenes/buy.ts)
- [src/scenes/renew.ts](/home/personal/rwbot/src/scenes/renew.ts)
- [src/scenes/wallet-charge.ts](/home/personal/rwbot/src/scenes/wallet-charge.ts)
- [src/scenes/admin-add-plan.ts](/home/personal/rwbot/src/scenes/admin-add-plan.ts)
- [src/scenes/admin-edit-plan.ts](/home/personal/rwbot/src/scenes/admin-edit-plan.ts)
- [src/scenes/admin-add-promo.ts](/home/personal/rwbot/src/scenes/admin-add-promo.ts)

Responsibilities:

- Collect multi-step user/admin input
- Validate inputs at each step
- Persist temporary state in Telegraf wizard session
- Defer payment creation and provisioning to services

### 3. Service Layer

Files:

- [src/services/payment-orchestrator.ts](/home/personal/rwbot/src/services/payment-orchestrator.ts)
- [src/services/remnawave.ts](/home/personal/rwbot/src/services/remnawave.ts)
- [src/services/tetra98.ts](/home/personal/rwbot/src/services/tetra98.ts)
- [src/services/wallet.ts](/home/personal/rwbot/src/services/wallet.ts)
- [src/services/purchase-delivery.ts](/home/personal/rwbot/src/services/purchase-delivery.ts)
- [src/services/notification.ts](/home/personal/rwbot/src/services/notification.ts)
- [src/services/cleanup.ts](/home/personal/rwbot/src/services/cleanup.ts)
- [src/services/qr-generator.ts](/home/personal/rwbot/src/services/qr-generator.ts)

Responsibilities:

- Enforce core business rules
- Talk to RemnaWave and Tetra98
- Manage wallet balance atomically
- Convert successful payments into subscriptions or renewals
- Deliver subscription links/QRs to users
- Run scheduled jobs

### 4. Persistence Layer

Files:

- [prisma/schema.prisma](/home/personal/rwbot/prisma/schema.prisma)
- [src/lib/prisma.ts](/home/personal/rwbot/src/lib/prisma.ts)

Responsibilities:

- Data modeling
- Transactions
- Query composition
- Referential integrity

## Core Bot Setup

## Telegraf Initialization

The bot is created in [src/bot.ts](/home/personal/rwbot/src/bot.ts) with:

- `Telegraf<BotContext>(env.BOT_TOKEN)`
- session middleware
- `Scenes.Stage` for all wizards
- `telegraf-ratelimit` configured to 4 updates per second per user
- a scene-reset middleware that cancels active wizards when the user sends a new command or unrelated button

## Long Polling

`src/app.ts` launches the bot via:

```ts
await bot.launch();
```

There is no Telegram webhook route in the current implementation.

## SOCKS5 Support for RemnaWave

[src/services/remnawave.ts](/home/personal/rwbot/src/services/remnawave.ts) supports optional SOCKS5 proxying for **all** RemnaWave API calls via:

- `REMNAWAVE_SOCKS5_URL`
- or `REMNAWAVE_SOCKS5_HOST`, `REMNAWAVE_SOCKS5_PORT`, `REMNAWAVE_SOCKS5_USERNAME`, `REMNAWAVE_SOCKS5_PASSWORD`

If configured, Axios is created with `httpAgent`, `httpsAgent`, and `proxy: false`.

## HTTP Server

[src/app.ts](/home/personal/rwbot/src/app.ts) also creates a minimal Node HTTP server for:

| Route | Purpose |
| --- | --- |
| `GET /health` | Health check for local/docker operations |
| `POST /callback/tetra98` | Payment callback receiver and verifier |

## Database Models

The Prisma schema is the canonical data model.

### `User`

Represents a Telegram user.

Important fields:

| Field | Meaning |
| --- | --- |
| `telegramId` | Unique Telegram numeric ID |
| `telegramUsername`, `firstName`, `lastName` | Metadata synced from Telegram |
| `isBanned` | Hard block from bot usage |
| `maxActivePlans` | Optional per-user cap on active paid services |
| `walletBalanceTomans` | Wallet balance in Tomans |
| `usedTestSubscription` | Enforces one lifetime test per Telegram ID |
| `affiliateRewardProcessed` | Future referral bookkeeping |
| `referredById` | Self-reference for referral support |

### `Plan`

Represents a sellable plan definition.

Important fields:

| Field | Meaning |
| --- | --- |
| `name` | System identifier |
| `displayName` | User-facing title |
| `trafficGb` | Included traffic |
| `durationDays` | Expiry duration |
| `priceTomans` | Base price |
| `internalSquadId` | Comma-separated RemnaWave internal squad IDs |
| `isActive` | Visibility/sale toggle |

Notes:

- `@@unique([name, trafficGb, durationDays])` prevents duplicate plan definitions.
- `internalSquadId` is stored as a string and parsed later via `parseInternalSquadIds()`.

### `Service`

Represents a provisioned VPN subscription for a user.

Important fields:

| Field | Meaning |
| --- | --- |
| `userId` | Owner |
| `planId` | Source plan, nullable for test services |
| `name` | User-selected local service label |
| `remnaUsername` | Unique username on RemnaWave |
| `remnaUserUuid` | Canonical external RemnaWave user ID |
| `shortUuid` | Optional short identifier from RemnaWave |
| `subscriptionUrl` | Cached subscription/smart link |
| `trafficLimitBytes` | Traffic ceiling |
| `expireAt` | Expiry timestamp |
| `isTest` | Distinguishes test vs paid service |
| `isActive` | Local active marker |
| `lastKnownUsedBytes` | Cached usage snapshot |

Notes:

- `@@unique([userId, name])` makes service names unique per user.
- Services are periodically refreshed from RemnaWave during listing/notifications.

### `Payment`

Represents an attempted or successful monetary operation.

Important fields:

| Field | Meaning |
| --- | --- |
| `type` | `WALLET_CHARGE`, `PURCHASE`, `RENEWAL` |
| `gateway` | `TETRA98`, `WALLET`, `MANUAL` |
| `status` | `PENDING`, `PROCESSING`, `WAITING_REVIEW`, `SUCCESS`, `FAILED`, `CANCELED` |
| `amountTomans` | Stored amount in Tomans |
| `amountRials` | Stored amount in Rials for gateway/manual instructions |
| `authority` | Tetra98 authority, unique |
| `hashId` | Internal payment correlation key |
| `targetServiceId` | Renewal target service |
| `planId` | Purchase/renewal plan association |
| `promoCodeId` | Applied promo, if any |
| `manualReceiptFileId` | Telegram receipt image file ID |
| `callbackPayload` | Free-form payload, currently used for `serviceName` and tetra authority |
| `reviewedByAdminId`, `reviewNote` | Manual review bookkeeping |
| `completedAt` | Success timestamp |

### `WalletTransaction`

Immutable wallet ledger entry.

Important fields:

| Field | Meaning |
| --- | --- |
| `amountTomans` | Positive for credit, negative for debit |
| `balanceAfterTomans` | Resulting balance |
| `type` | `CHARGE`, `PURCHASE`, `ADMIN_ADJUST`, `AFFILIATE_REWARD` |
| `description` | Human-readable reason |
| `paymentId` | Optional payment link |

### `Promo`

Discount definition.

Important fields:

| Field | Meaning |
| --- | --- |
| `code` | Unique uppercase promo code |
| `type` | `PERCENT` or `FIXED` |
| `value` | Percent or fixed Toman amount |
| `maxUses`, `currentUses` | Global usage cap |
| `isActive` | Admin toggle |
| `expiresAt` | Optional expiration |

### `PromoUsage`

Tracks one promo usage per payment and user.

Important fields:

| Field | Meaning |
| --- | --- |
| `promoCodeId` | Promo reference |
| `userId` | User reference |
| `paymentId` | Unique per payment |

### `Setting`

Singleton operational configuration row (`id = 1`).

Important fields:

| Field | Meaning |
| --- | --- |
| `testEnabled`, `testTrafficBytes`, `testDurationDays`, `testInternalSquadId` | Free test controls |
| `notifyDaysLeft`, `notifyGbLeft` | Notification thresholds |
| `enableManualPayment`, `enableTetra98` | Gateway toggles |
| `enablePromos`, `enableReferrals` | Feature toggles |
| `enableNewPurchases`, `enableRenewals` | Sales switches |
| `affiliateRewardType`, `affiliateRewardValue` | Future referral settings |
| `manualCardNumber` | Card number shown for manual payments |
| `supportHandle` | Support contact handle |

## Major Components

## 1. Payment Orchestrator

File: [src/services/payment-orchestrator.ts](/home/personal/rwbot/src/services/payment-orchestrator.ts)

This is the most important business service in the repository.

Responsibilities:

- Build purchase and renewal previews
- Validate service names
- Enforce duplicate-name prevention
- Enforce active-plan limits
- Compute promo discounts
- Randomize manual payment amounts
- Create `Payment` rows
- Debit/credit wallet when needed
- Create Tetra98 orders
- Accept manual receipt uploads
- Lock and finalize successful payments
- Provision test subscriptions

Key methods:

| Method | Purpose |
| --- | --- |
| `createPurchasePaymentPreview()` | Validate purchase before gateway choice |
| `createRenewPaymentPreview()` | Validate renewal before gateway choice |
| `createPurchasePayment()` | Create purchase payment and optionally auto-complete wallet flow |
| `createRenewPayment()` | Create renewal payment and optionally auto-complete wallet flow |
| `createWalletChargePayment()` | Create wallet top-up payment |
| `createTetra98Order()` | Create authority/link pair for Tetra98 |
| `submitManualReceipt()` | Attach Telegram receipt image to manual payment |
| `processSuccessfulPayment()` | Lock payment, execute side effects, mark success |
| `markPaymentFailed()` | Move payment into failed state |
| `rejectManualPayment()` | Cancel a manual payment with admin note |
| `createTestSubscription()` | Provision one-time test service |

## 2. RemnaWave Service

File: [src/services/remnawave.ts](/home/personal/rwbot/src/services/remnawave.ts)

Wraps the RemnaWave backend contract and centralizes API behavior:

- Create user
- Update user
- Delete user
- Fetch user by username
- Fetch subscription by UUID
- Reset user traffic

Implementation details:

- Base URL normalization removes trailing slash and `/api`
- Uses contract-provided URLs and schemas
- Retries retryable failures up to 3 times
- Logs failed attempts
- Supports optional SOCKS5 proxying

## 3. Purchase Delivery

File: [src/services/purchase-delivery.ts](/home/personal/rwbot/src/services/purchase-delivery.ts)

After a successful purchase, this service:

- finds the newly created `Service`
- re-fetches subscription data from RemnaWave
- stores the latest `subscriptionUrl`
- sends a success message
- generates and sends a QR image
- sends an emergency link button

This service is used after:

- wallet-based purchase success
- Tetra98 callback verification success
- admin approval of manual purchase payments
- test subscription creation

## 4. Wallet Service

File: [src/services/wallet.ts](/home/personal/rwbot/src/services/wallet.ts)

Implements atomic wallet balance changes using Prisma transactions:

- Reads current balance
- Prevents negative resulting balance
- Updates `User.walletBalanceTomans`
- Inserts immutable `WalletTransaction`

## 5. Tetra98 Service

File: [src/services/tetra98.ts](/home/personal/rwbot/src/services/tetra98.ts)

Responsibilities:

- Create order with `ApiKey`, `Hash_id`, `Amount`, and callback URL
- Verify authority returned via callback
- Produce Telegram payment link format

Important note:

- `createTetra98Order()` in the orchestrator builds callback URLs using `env.APP_URL`. If Tetra98 is enabled, `APP_URL` is effectively required.

## 6. QR Generator

File: [src/services/qr-generator.ts](/home/personal/rwbot/src/services/qr-generator.ts)

Responsibilities:

- Render subscription data as QR PNG
- Optionally place a center logo loaded from `LOGO_PATH`
- Convert SVG logo to PNG when needed

Important note:

- QR rendering relies on the `jsdom` globals initialized in [src/app.ts](/home/personal/rwbot/src/app.ts).

## 7. Notifications

File: [src/services/notification.ts](/home/personal/rwbot/src/services/notification.ts)

Daily job at `16:00 Asia/Tehran`:

- loads notification thresholds from `Setting`
- refreshes each active service from RemnaWave
- updates local cached usage/expiry/subscription URL
- notifies users when remaining GB or days are below threshold

## 8. Cleanup Jobs

File: [src/services/cleanup.ts](/home/personal/rwbot/src/services/cleanup.ts)

Scheduled jobs:

| Schedule | Purpose |
| --- | --- |
| `03:00 Asia/Tehran` | Delete expired test services immediately |
| `04:00 Asia/Tehran` | Delete paid services expired for more than 7 days |

Cleanup strategy:

- delete user remotely in RemnaWave first
- delete local `Service` row second
- retry remote deletion up to 2 times

## Admin Commands and User Flows

## User Flows

### `/start`

Implemented in [src/commands/start.ts](/home/personal/rwbot/src/commands/start.ts).

Behavior:

- upserts the user
- rate-limits bursty `/start`
- requires a simple math captcha if the Telegram account has no username
- shows persistent main menu keyboard

### Buy Flow

Entry points:

- menu button `🔮 خرید سرویس`
- `/buy`

Scene: [src/scenes/buy.ts](/home/personal/rwbot/src/scenes/buy.ts)

Steps:

1. Select active plan
2. Enter service name
3. Enter promo code or `-`
4. View price preview
5. Choose gateway: wallet, Tetra98, or manual
6. Complete according to gateway

Manual flow:

- a randomized payable amount is generated
- user is instructed to send exact amount
- receipt photo is stored and forwarded to admins
- payment stays `WAITING_REVIEW` until admin action

### Renew Flow

Entry points:

- `/renew`
- inline button from service details

Scene: [src/scenes/renew.ts](/home/personal/rwbot/src/scenes/renew.ts)

Steps:

1. Select eligible service or use preselected service ID
2. Enter promo code or `-`
3. View renewal preview
4. Choose gateway
5. Complete renewal

Renewal applies the service plan’s duration again and resets traffic usage on RemnaWave.

### My Services Flow

Implemented in [src/commands/start.ts](/home/personal/rwbot/src/commands/start.ts).

Features:

- list paid services
- sync cached usage/expiry/subscription URL from RemnaWave
- view service details
- retrieve smart link
- retrieve emergency links
- generate QR
- jump into renewal

### Test Service Flow

Entry point:

- menu button `🎁 تست رایگان`

Behavior:

- calls `paymentOrchestrator.createTestSubscription()`
- enforces one test per Telegram ID
- uses `Setting.test*` configuration
- creates a service with `planId = null` and `isTest = true`

### Wallet Flow

Entry points:

- menu button `💸 کیف پول`
- inline button `💳 شارژ کیف پول`

Scene: [src/scenes/wallet-charge.ts](/home/personal/rwbot/src/scenes/wallet-charge.ts)

Behavior:

- shows current wallet balance
- accepts amount within configured min/max range
- supports Tetra98 and manual top-up
- stores approved top-ups as `Payment` records

### Support Flow

Entry point:

- menu button `👤 پشتیبانی`

Behavior:

- sends a direct Telegram link based on `Setting.supportHandle` or fallback `ADMIN_TG_HANDLE`

## Admin Commands

Implemented in [src/commands/admin.ts](/home/personal/rwbot/src/commands/admin.ts).

### Monitoring and Listing

- `/admin`
- `/stats`
- `/users [limit]`
- `/services [limit]`
- `/payments [limit]`
- `/manuals`
- `/plans`
- `/listpromos`

### User and Wallet Controls

- `/ban <tg_id>`
- `/unban <tg_id>`
- `/wallet <tg_id> <amount>`
- `/setactiveplans <telegram_id> <limit|null>`
- `/resettest <tg_id>`
- `/resetalltests`

### Sales and Feature Toggles

- `/togglemanual`
- `/toggletetra`
- `/togglesales`
- `/togglerenew`
- `/testtoggle <on|off>`
- `/setnotify <days> <gb>`
- `/setaffiliate <fixed|percent> <value>`

### Plan and Promo Management

- `/addplan`
- `/editplan`
- `/delplan <plan_id>`
- `/addpromo`
- `/togglepromo <code>`
- `/deletepromo <code>`

### Test Service Controls

- `/settest <traffic_gb> <days>`
- `/settestinternalsquad <id(s)>`

### Reporting and Broadcast

- `/salestoday`
- `/sales24h`
- `/salesweek`
- `/salesmonth`
- `/topusers [N]`
- `/broadcast <message>`

## Cron Jobs and Background Tasks

## Started at Bootstrap

[src/app.ts](/home/personal/rwbot/src/app.ts) starts:

- `startNotificationCron(bot)`
- `startCleanupCrons()`

## Background Responsibilities

- low-balance / near-expiry notification
- deletion of stale test services
- deletion of old expired paid services
- Tetra98 callback verification and payment finalization

## Environment Variables

Environment parsing lives in [src/config/env.ts](/home/personal/rwbot/src/config/env.ts). The `.env.example` file shows expected values, but not every variable in use is validated there.

### Core Runtime

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development`, `test`, or `production` |
| `PORT` | HTTP server port inside app runtime |
| `APP_PORT` | Docker host port mapping only |
| `APP_URL` | Public base URL used for Tetra98 callback URLs |
| `DATABASE_URL` | Prisma/PostgreSQL connection string |
| `RUN_SEED` | Docker startup seeding toggle |

### Telegram

| Variable | Purpose |
| --- | --- |
| `BOT_TOKEN` | Telegram bot token |
| `BOT_USERNAME` | Bot username without `@` |
| `ADMIN_TG_IDS` | Comma-separated Telegram admin IDs |
| `ADMIN_TG_HANDLE` | Fallback support/admin handle |

### RemnaWave

| Variable | Purpose |
| --- | --- |
| `REMNAWAVE_URL` | Base RemnaWave URL |
| `REMNAWAVE_TOKEN` | Bearer token for RemnaWave |
| `DEFAULT_INTERNAL_SQUAD_ID` | Default squad used in seed/test fallback |
| `REMNAWAVE_SOCKS5_URL` | Direct SOCKS5 proxy URL |
| `REMNAWAVE_SOCKS5_HOST` | SOCKS5 host |
| `REMNAWAVE_SOCKS5_PORT` | SOCKS5 port |
| `REMNAWAVE_SOCKS5_USERNAME` | SOCKS5 username |
| `REMNAWAVE_SOCKS5_PASSWORD` | SOCKS5 password |

### Payments and Wallet

| Variable | Purpose |
| --- | --- |
| `TETRA98_API_KEY` | Tetra98 API key |
| `MANUAL_CARD_NUMBER` | Default card number for manual payments |
| `MANUAL_PAYMENT_LOWER_THRESHOLD_PERCENT` | Manual amount randomization lower bound |
| `MANUAL_PAYMENT_UPPER_THRESHOLD_PERCENT` | Manual amount randomization upper bound |
| `MIN_WALLET_CHARGE_TOMANS` | Minimum wallet top-up |
| `MAX_WALLET_CHARGE_TOMANS` | Maximum wallet top-up |

### QR / Branding

| Variable | Purpose |
| --- | --- |
| `LOGO_PATH` | Local file path for QR center logo |
| `LOGO_URL` | Parsed in `env.ts` but not used by the current QR service |

## Important Conventions and Patterns

## User Bootstrap on Every Update

`ensureKnownUser` in [src/middlewares/auth.ts](/home/personal/rwbot/src/middlewares/auth.ts) upserts the user from `ctx.from` before most bot logic runs.

Implication:

- You usually do not need separate “register user” logic in commands.

## Scene Opt-Out Pattern

In [src/bot.ts](/home/personal/rwbot/src/bot.ts), if the user is inside a wizard and sends a different command/menu action, the scene is force-reset.

Implication:

- New top-level buttons/commands should be considered part of the opt-out UX.

## Settings Singleton Pattern

Operational toggles live in one `Setting` row with `id = 1`.

Implication:

- New global feature flags should usually be added to `Setting`, surfaced in seed, and optionally exposed by admin command.

## Two Sources of Truth

- Local DB stores business context, ledger, and cached service state.
- RemnaWave stores actual VPN account state.

Implication:

- When changing service lifecycle logic, update both sides carefully.

## Idempotent Payment Finalization

`processSuccessfulPayment()` first acquires a logical lock by updating status to `PROCESSING`.

Implication:

- Success handling is intentionally defensive against duplicate callbacks/admin actions.

## Manual Payment Review Pattern

Manual payments:

- may start as `WAITING_REVIEW`
- store Telegram photo `file_id`
- require explicit admin approval/rejection

Implication:

- Any new manual-review flow should preserve status semantics and admin traceability.

## Business Rules and Custom Logic

## 1. Limited Stock / Active Plan Limit

There is no inventory stock count per plan, but there is a **per-user active service cap** using `User.maxActivePlans`.

How it works:

- purchase preview and purchase creation call `assertUserCanCreateNewService()`
- local service rows are inspected first
- RemnaWave subscription state is queried live when possible
- if active count reaches the cap, purchase is blocked

This is one of the more complex rules in the codebase.

## 2. Service Name Uniqueness

Paid service names are user-selected and must:

- match `^[a-zA-Z0-9_-]{3,24}$`
- be unique per user

The external RemnaWave username is not the same value. It is generated as:

- `tg_<telegramId>-<sanitizedName>-<randomSuffix>`

This separation lets users choose readable labels without risking collisions in the external system.

## 3. Manual Payment Randomization

For `PaymentGateway.MANUAL`, the bot does **not** necessarily ask the user to pay the exact base price.

Instead:

- the final price is first computed after promo application
- then the payable amount is randomized inside configurable lower/upper thresholds

Purpose:

- make manual bank-transfer matching easier or safer operationally
- force the user to transfer the exact instructed amount

Important consequence:

- wallet and online prices can differ from manual transfer instructions for the same purchase.

## 4. Promo Validation Rules

Promos are rejected when:

- not found
- inactive
- expired
- max uses reached
- already used by the same user
- final discounted amount drops below `MIN_WALLET_CHARGE_TOMANS`

Promo usage is marked only after successful payment completion.

## 5. Renewal Logic Resets Traffic

Renewal does not simply extend expiry locally.

It:

- recalculates expiry from `max(now, currentExpireAt)`
- updates RemnaWave user with the plan traffic and new expiry
- resets remote traffic usage
- resets local `lastKnownUsedBytes` to zero

Contributors should verify this matches business intent before changing renewal semantics.

## 6. Test Subscription Rules

Test subscriptions:

- are controlled from `Setting`
- are lifetime-limited per Telegram user
- do not link to a `Plan`
- are deleted automatically once expired

## 7. Captcha for Username-Less Accounts

Users without a Telegram username are required to solve a simple math captcha on `/start`.

This is a lightweight anti-abuse measure.

## 8. Tehran Time for Reporting and Jobs

Sales reports and cron jobs use `Asia/Tehran`.

If you add date-sensitive features, preserve timezone awareness.

## How to Extend

## Add a New Plan Type

Use this when you want to sell a new product variant.

Recommended steps:

1. Create it through `/addplan` if no code changes are needed.
2. If the new plan needs new fields, update [prisma/schema.prisma](/home/personal/rwbot/prisma/schema.prisma).
3. Add a migration.
4. Update any preview, delivery, reporting, or renewal logic that depends on plan structure.
5. Update `prisma/seed.ts` if the new plan should exist by default.

If the new plan should map differently to RemnaWave:

1. Add or reuse `internalSquadId` values.
2. Ensure `parseInternalSquadIds()` still produces what `remnawaveService.createUser()` expects.

## Add a New Admin Command

Recommended pattern:

1. Implement the command in [src/commands/admin.ts](/home/personal/rwbot/src/commands/admin.ts).
2. Reuse `isAdmin(ctx)` or `ensureAdminUser()` as appropriate.
3. If the command modifies global runtime behavior, store the setting in `Setting`.
4. If the command needs multi-step input, create a new wizard in `src/scenes/` and register it in [src/bot.ts](/home/personal/rwbot/src/bot.ts).

Example ideas:

- toggle referral support
- export failed manual payments
- resync a service from RemnaWave

## Add a New User Flow

Recommended pattern:

1. Add a new entry point in `src/commands/` or `src/commands/start.ts`.
2. Use a wizard scene if the flow is multi-step.
3. Keep Telegram interaction thin.
4. Put business rules in a service, not in the command handler.
5. Reuse `AppError` for user-facing validation failures.

Example: adding a “change service name” flow

1. Create `src/scenes/rename-service.ts`
2. Validate ownership and new name format
3. Update local `Service.name`
4. Decide whether RemnaWave username should remain unchanged or also be mutated
5. Register the scene in [src/bot.ts](/home/personal/rwbot/src/bot.ts)

## Add a New Payment Gateway

Recommended steps:

1. Extend `PaymentGateway` enum in Prisma.
2. Add migration.
3. Create a service similar to `tetra98.ts`.
4. Extend payment button rendering in buy/renew/wallet scenes.
5. Extend `createPurchasePayment()`, `createRenewPayment()`, and `createWalletChargePayment()` as needed.
6. Add callback or webhook handling in [src/app.ts](/home/personal/rwbot/src/app.ts) if required.
7. Preserve `processSuccessfulPayment()` as the single finalization path.

## Add a New Background Job

Recommended steps:

1. Implement it in a new file under `src/services/`.
2. Keep schedule timezone explicit.
3. Start it from [src/app.ts](/home/personal/rwbot/src/app.ts).
4. Log both start and failures clearly.

## Troubleshooting and Common Pitfalls

## Common Runtime Issues

### Tetra98 payments fail before redirect

Check:

- `TETRA98_API_KEY`
- `APP_URL`
- outbound network access from the app container

Why:

- Tetra98 order creation needs a valid callback URL.

### Tetra98 callback arrives but payment is not delivered

Check:

- `/callback/tetra98` reachability
- stored `authority`
- callback payload status value
- verification result from Tetra98
- app logs for `processSuccessfulPayment()` failure

### User paid manually but nothing happens

Check:

- payment is in `WAITING_REVIEW`
- receipt `file_id` exists
- admins received the forwarded photo
- admin approved using the inline button

### Service exists in DB but user cannot fetch link

Check:

- `Service.remnaUserUuid` and `remnaUsername`
- RemnaWave API connectivity
- whether the remote subscription endpoint is returning `subscriptionUrl`, `base64`, or emergency links

### Purchase blocked unexpectedly

Check:

- duplicate service name
- inactive plan
- promo rejection
- insufficient wallet balance
- `maxActivePlans` limit

### QR generation fails

Check:

- `LOGO_PATH` points to a readable file
- `src/app.ts` still initializes `jsdom` globals before QR generation
- SVG logo conversion is not failing

### Notifications or cleanup do not run

Check:

- process uptime
- container clock/timezone assumptions
- cron startup in `bootstrap()`
- RemnaWave API failures during job execution

## Codebase Pitfalls

### README/setup references webhook behavior

The current application code does not register a Telegram webhook endpoint. Treat long polling as the active runtime model unless the bot is explicitly extended.

### `APP_URL` is optional in env parsing but practically required for Tetra98

If online payments are enabled, missing `APP_URL` will break callback URL construction.

### `LOGO_PATH` is used but not validated in `env.ts`

The QR service reads `process.env.LOGO_PATH` directly. A bad path fails at runtime, not at startup.

### Paid service listing excludes test services

This is intentional. If you expose test services in UI later, update listing and actions carefully.

### Renewal assumes plan-backed services

Test services cannot be renewed because they have `planId = null`.

### Wallet and payment ledger must stay consistent

Do not update `walletBalanceTomans` directly outside `walletService` unless you are deliberately bypassing ledger integrity.

### RemnaWave state may diverge from local cache

Whenever you change service lifecycle behavior, consider both:

- local `Service` row
- remote RemnaWave user/subscription

## Contributor Guidance

- Prefer adding business logic to services, not command handlers.
- Prefer adding feature toggles to `Setting` when behavior may need runtime control.
- Keep all user-facing purchase completion paths converging on `processSuccessfulPayment()`.
- Preserve timezone-aware logic for reports and scheduled work.
- When in doubt, treat `payment-orchestrator.ts` as the central workflow file and extend around it rather than duplicating payment logic elsewhere.
