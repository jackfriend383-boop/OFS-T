-- Round 7: prices and shipping editable from the admin "Prices" tab.
-- Run once BEFORE deploying the new Worker:
--   npx wrangler d1 execute ofst-orders --remote --file=./migrations/0011_prices.sql
-- One row per price the owner changed (no row = the default in src/data/designs.json). Safe to run again.
-- key   : door | window | accent | badge | shipping | freeFrom   (euros per PAIR / per order, stored as cents)
-- cents : shipping 0 = free delivery; freeFrom 0 = no "free above" threshold
CREATE TABLE IF NOT EXISTS site_prices (
  key        TEXT PRIMARY KEY CHECK (key IN ('door', 'window', 'accent', 'badge', 'shipping', 'freeFrom')),
  cents      INTEGER NOT NULL CHECK (cents BETWEEN 0 AND 1000000),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
