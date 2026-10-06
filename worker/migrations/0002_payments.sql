-- Only for a database created BEFORE Stripe payments were added (schema.sql already contains these columns for new ones).
-- Run once:  npx wrangler d1 execute ofst-orders --remote --file=./migrations/0002_payments.sql   (use --local for local dev)
-- Orders that already exist stay 'unpaid' (they were never charged online); change them by hand if you took payment by email.
ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'failed', 'expired', 'mismatch'));
ALTER TABLE orders ADD COLUMN stripe_session_id TEXT;
ALTER TABLE orders ADD COLUMN paid_at TEXT;
ALTER TABLE orders ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS orders_stripe_session_idx ON orders (stripe_session_id);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, created_at DESC);
