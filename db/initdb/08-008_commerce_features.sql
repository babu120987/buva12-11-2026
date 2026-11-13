-- 008: Amazon/Flipkart-style commerce features for the BUVA store.
-- Additive and idempotent: safe to run on an existing database.

-- ---------- sizes: products that share a variant_group are shown as size options ----------
ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_group TEXT;
CREATE INDEX IF NOT EXISTS products_variant_group_idx ON products(variant_group) WHERE variant_group IS NOT NULL;

-- ---------- timed deals (the server swaps the price in at start and restores it at the end) ----------
CREATE TABLE IF NOT EXISTS deals (
  id                     BIGSERIAL PRIMARY KEY,
  product_id             BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title                  TEXT NOT NULL DEFAULT 'Limited-time deal',
  deal_price_paise       INTEGER NOT NULL CHECK (deal_price_paise > 0),
  starts_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at                TIMESTAMPTZ NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'ended', 'cancelled')),
  original_price_paise   INTEGER,
  original_compare_paise INTEGER,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS deals_status_idx ON deals(status, starts_at, ends_at);
-- at most one running deal per product
CREATE UNIQUE INDEX IF NOT EXISTS deals_one_active_per_product ON deals(product_id) WHERE status = 'active';

-- ---------- combo offers: "Buy 2, save 10%" (optionally within one scent family) ----------
CREATE TABLE IF NOT EXISTS combo_offers (
  id                   BIGSERIAL PRIMARY KEY,
  title                TEXT NOT NULL,
  min_quantity         INTEGER NOT NULL CHECK (min_quantity >= 2),
  scent_family         TEXT,
  discount_type        TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value       INTEGER NOT NULL CHECK (discount_value > 0),
  stack_with_coupons   BOOLEAN NOT NULL DEFAULT FALSE,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at            TIMESTAMPTZ,
  ends_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (discount_type <> 'percentage' OR discount_value <= 90)
);

-- ---------- coupons shown in the bag ----------
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS show_in_store BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS description TEXT;

-- ---------- reviews: photos and "was this helpful?" ----------
CREATE TABLE IF NOT EXISTS review_photos (
  id          BIGSERIAL PRIMARY KEY,
  review_id   UUID NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
  image_url   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS review_photos_review_idx ON review_photos(review_id);

CREATE TABLE IF NOT EXISTS review_votes (
  review_id   UUID NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
  voter_key   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (review_id, voter_key)
);

-- ---------- back-in-stock / price-drop alerts ----------
CREATE TABLE IF NOT EXISTS stock_alerts (
  id                     BIGSERIAL PRIMARY KEY,
  product_id             BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  email                  TEXT NOT NULL,
  customer_id            UUID REFERENCES customers(id) ON DELETE SET NULL,
  kind                   TEXT NOT NULL CHECK (kind IN ('back_in_stock', 'price_drop')),
  price_at_request_paise INTEGER,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at            TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_alerts_pending_unique ON stock_alerts(product_id, lower(email), kind) WHERE notified_at IS NULL;

-- wishlist price-drop emails: price seen when saved / last alerted
ALTER TABLE wishlists ADD COLUMN IF NOT EXISTS price_alert_paise INTEGER;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS price_alerts BOOLEAN NOT NULL DEFAULT TRUE;

-- ---------- BUVA points ----------
CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id           BIGSERIAL PRIMARY KEY,
  customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id     UUID REFERENCES orders(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('earn', 'redeem', 'refund', 'reverse', 'adjust')),
  points       INTEGER NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS loyalty_ledger_customer_idx ON loyalty_ledger(customer_id, created_at DESC);
-- one earn / redeem / refund / reverse row per order
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_ledger_order_kind ON loyalty_ledger(order_id, kind) WHERE order_id IS NOT NULL AND kind <> 'adjust';

-- ---------- orders: breakdown of new discounts and gift wrap ----------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (coupon_discount_paise >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS combo_discount_paise  INTEGER NOT NULL DEFAULT 0 CHECK (combo_discount_paise >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS combo_offer_id        BIGINT REFERENCES combo_offers(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_redeemed       INTEGER NOT NULL DEFAULT 0 CHECK (points_redeemed >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (points_discount_paise >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_wrap             BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_message          TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_wrap_paise       INTEGER NOT NULL DEFAULT 0 CHECK (gift_wrap_paise >= 0);
