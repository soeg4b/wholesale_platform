-- Iteration 3 constraints Prisma cannot express. Idempotent; re-apply after every `db:push`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'operator_reviews_rating_chk') THEN
    ALTER TABLE operator_reviews ADD CONSTRAINT operator_reviews_rating_chk CHECK ("rating" BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prebuild_products_progress_chk') THEN
    ALTER TABLE prebuild_products ADD CONSTRAINT prebuild_products_progress_chk
      CHECK ("progressPct" BETWEEN 0 AND 100 AND "earlyBirdSlots" >= 0 AND "earlyBirdPrice" <= "basePrice");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallet_entries_sign_chk') THEN
    ALTER TABLE wallet_entries ADD CONSTRAINT wallet_entries_sign_chk CHECK (
      ("type" IN ('TOPUP', 'REFUND') AND "amount" > 0)
      OR ("type" = 'CHARGE' AND "amount" < 0)
      OR ("type" = 'ADJUSTMENT' AND "amount" <> 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'link_requests_capacity_chk') THEN
    ALTER TABLE link_requests ADD CONSTRAINT link_requests_capacity_chk CHECK ("capacityMbps" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'buyer_profiles_alert_chk') THEN
    ALTER TABLE buyer_profiles ADD CONSTRAINT buyer_profiles_alert_chk
      CHECK ("alertThresholdPct" IS NULL OR "alertThresholdPct" BETWEEN 1 AND 200);
  END IF;
END $$;

-- Wallet is append-only (corrections are new ADJUSTMENT rows).
CREATE OR REPLACE FUNCTION wallet_entries_immutable() RETURNS trigger AS $$
BEGIN
  -- Only the FK "ON DELETE SET NULL" from reservations may touch a row.
  IF NEW."reservationId" IS NULL AND NEW."amount" = OLD."amount" AND NEW."type" = OLD."type"
     AND NEW."buyerProfileId" = OLD."buyerProfileId" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'wallet_entries is append-only';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wallet_entries_no_update ON wallet_entries;
CREATE TRIGGER wallet_entries_no_update BEFORE UPDATE ON wallet_entries
  FOR EACH ROW EXECUTE FUNCTION wallet_entries_immutable();
