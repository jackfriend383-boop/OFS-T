-- Orders are now saved only once they are PAID. While the customer is on Stripe's payment page the order is a draft in this
-- table; Stripe's signed webhook moves it into `orders` when the payment succeeds, and it is deleted when the customer
-- cancels, the payment fails or the Stripe session expires.
-- Run once (before deploying the new Worker):
--   npx wrangler d1 execute ofst-orders --remote --file=./migrations/0005_pending_checkouts.sql   (use --local for local dev)
-- Safe to run twice (IF NOT EXISTS). Nothing in `orders` is changed.
CREATE TABLE IF NOT EXISTS pending_checkouts (
  id                   TEXT PRIMARY KEY CHECK (length(id) = 36),
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  customer             TEXT NOT NULL CHECK (json_valid(customer) AND json_type(customer) = 'object' AND length(customer) <= 2000),
  items                TEXT NOT NULL CHECK (json_valid(items) AND json_type(items) = 'array'
                                            AND json_array_length(items) BETWEEN 1 AND 50 AND length(items) <= 30000),
  total_cents          INTEGER NOT NULL CHECK (total_cents BETWEEN 1 AND 1000000),
  lang                 TEXT CHECK (lang IS NULL OR length(lang) BETWEEN 2 AND 5),
  consent_personalised INTEGER CHECK (consent_personalised IS NULL OR consent_personalised = 1),
  user_id              TEXT,
  stripe_session_id    TEXT,
  -- 1 = the customer finished on Stripe with a slow payment method (e.g. Multibanco) and the money has not arrived yet.
  awaiting_payment     INTEGER NOT NULL DEFAULT 0 CHECK (awaiting_payment IN (0, 1))
);
CREATE INDEX IF NOT EXISTS pending_checkouts_created_idx ON pending_checkouts (created_at);
