-- Return requests: used by /api/account and /api/admin/return-requests.
-- This table existed on the old production server but was missing from the
-- repository migrations, so it is created here (idempotent).
CREATE TABLE IF NOT EXISTS return_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL,
  customer_note TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS return_requests_order_idx ON return_requests(order_id);
CREATE INDEX IF NOT EXISTS return_requests_status_idx ON return_requests(status, created_at DESC);
