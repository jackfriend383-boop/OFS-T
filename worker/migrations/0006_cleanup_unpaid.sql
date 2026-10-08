-- OPTIONAL one-off clean-up: removes the unpaid / cancelled / expired orders that the OLD Worker saved as soon as a customer
-- opened Stripe's payment page. Paid orders (and 'mismatch' ones, which need a manual check) are NOT touched.
-- Run it only AFTER the new Worker has been live for at least a day, so nobody is still paying in an old session
-- (and check the Stripe dashboard for Multibanco payments still waiting to be paid: those would be lost):
--   npx wrangler d1 execute ofst-orders --remote --file=./migrations/0006_cleanup_unpaid.sql
DELETE FROM orders WHERE payment_status IN ('unpaid', 'failed', 'expired');
