-- Round 4: promotion codes, refunds and disputes.
-- Run once BEFORE deploying the new Worker:
--   npx wrangler d1 execute ofst-orders --remote --file=./migrations/0008_refunds_and_discounts.sql
-- payment_intent : Stripe's payment id, so a refund or dispute (which Stripe reports per payment, not per checkout) finds its order.
-- paid_cents     : what the customer actually paid (lower than total_cents when a promotion code was used). NULL on older orders.
-- refund_status  : NULL (normal), 'partial', 'refunded', 'disputed', 'dispute_won' or 'dispute_lost'. Set only by the Stripe webhook.
-- refunded_cents : total refunded so far.
ALTER TABLE orders ADD COLUMN payment_intent TEXT;
ALTER TABLE orders ADD COLUMN paid_cents INTEGER;
ALTER TABLE orders ADD COLUMN refund_status TEXT;
ALTER TABLE orders ADD COLUMN refunded_cents INTEGER;
CREATE INDEX IF NOT EXISTS orders_payment_intent_idx ON orders (payment_intent);
