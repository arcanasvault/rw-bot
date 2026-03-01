-- Create PromoType enum if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PromoType') THEN
    CREATE TYPE "PromoType" AS ENUM ('PERCENT', 'FIXED');
  END IF;
END $$;

-- Rename PromoCode table to Promo (if needed)
DO $$
BEGIN
  IF to_regclass('"PromoCode"') IS NOT NULL AND to_regclass('"Promo"') IS NULL THEN
    ALTER TABLE "PromoCode" RENAME TO "Promo";
  END IF;
END $$;

-- Ensure promo schema matches latest model
DO $$
BEGIN
  IF to_regclass('"Promo"') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'Promo' AND column_name = 'discountPercent'
    ) THEN
      ALTER TABLE "Promo" RENAME COLUMN "discountPercent" TO "value";
      ALTER TABLE "Promo" ADD COLUMN "type" "PromoType" NOT NULL DEFAULT 'PERCENT';
      UPDATE "Promo"
      SET "type" = 'FIXED'
      WHERE COALESCE("fixedTomans", 0) > 0;
      UPDATE "Promo"
      SET "value" = COALESCE("fixedTomans", "value", 0)
      WHERE "type" = 'FIXED';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'Promo' AND column_name = 'usesLeft'
    ) THEN
      ALTER TABLE "Promo" RENAME COLUMN "usesLeft" TO "maxUses";
      ALTER TABLE "Promo" ADD COLUMN "currentUses" INTEGER NOT NULL DEFAULT 0;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'Promo' AND column_name = 'fixedTomans'
    ) THEN
      ALTER TABLE "Promo" DROP COLUMN "fixedTomans";
    END IF;

    -- Make sure required columns/defaults are present
    ALTER TABLE "Promo" ALTER COLUMN "value" SET NOT NULL;
    ALTER TABLE "Promo" ALTER COLUMN "maxUses" SET NOT NULL;
    ALTER TABLE "Promo" ALTER COLUMN "currentUses" SET NOT NULL;
    ALTER TABLE "Promo" ALTER COLUMN "currentUses" SET DEFAULT 0;
    ALTER TABLE "Promo" ALTER COLUMN "isActive" SET DEFAULT true;

    -- Normalize code uniqueness index name (optional)
    IF NOT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE tablename = 'Promo' AND indexname = 'Promo_code_key'
    ) THEN
      CREATE UNIQUE INDEX "Promo_code_key" ON "Promo"("code");
    END IF;
  END IF;
END $$;

-- Re-enable promos and add global sales/renew toggles
ALTER TABLE "Setting"
  ALTER COLUMN "enablePromos" SET DEFAULT true;

UPDATE "Setting"
SET "enablePromos" = true
WHERE "enablePromos" = false;

ALTER TABLE "Setting"
  ADD COLUMN IF NOT EXISTS "enableNewPurchases" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "enableRenewals" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Setting"
SET
  "enableNewPurchases" = COALESCE("enableNewPurchases", true),
  "enableRenewals" = COALESCE("enableRenewals", true);
