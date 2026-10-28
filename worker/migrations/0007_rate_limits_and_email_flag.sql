-- Round 3 (security): per-visitor rate limits and "payment email sent" tracking.
-- Run once BEFORE deploying the new Worker:
--   npx wrangler d1 execute ofst-orders --remote --file=./migrations/0007_rate_limits_and_email_flag.sql
-- rate_hits: short-lived counters keyed by e.g. "link:<ip>" (sign-in links), "checkout:<ip>", "adminfail:<ip>". Rows older than a
-- day are deleted automatically. The IP is only used as a counter key and is never linked to an order or account.
CREATE TABLE IF NOT EXISTS rate_hits (
  key TEXT NOT NULL CHECK (length(key) <= 100),
  at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS rate_hits_key_at_idx ON rate_hits (key, at);
-- When the payment confirmation email was sent (the admin "resend" button now only picks orders still missing it).
-- Existing paid orders are marked as already emailed, so the button never re-sends to past customers.
ALTER TABLE orders ADD COLUMN paid_email_sent_at TEXT;
UPDATE orders SET paid_email_sent_at = COALESCE(paid_at, created_at) WHERE payment_status = 'paid';
