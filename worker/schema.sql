-- =====================================================================================================
-- OFS/T order database for Cloudflare D1 (SQLite). Safe to re-run: every statement uses IF NOT EXISTS and
-- no data is dropped.
--   Local test : npm run db:local     (inside worker/)
--   Production : npm run db:remote
--
-- Model
--   orders          : one row per checkout. Written ONLY by the Worker (POST /api/orders), which validates every field.
--   admin_sessions  : sign-in sessions for the owner. Only a SHA-256 hash of the token is stored, never the token.
--   login_attempts  : failed sign-ins, used to throttle password guessing.
--
-- The browser never talks to D1 directly (D1 has no public endpoint); it can only call the Worker's API. The checks
-- below are a second line of defence in case the Worker code ever has a bug.
-- =====================================================================================================

CREATE TABLE IF NOT EXISTS orders (
  id                   TEXT PRIMARY KEY CHECK (length(id) = 36),
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status               TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'printed', 'shipped')),
  -- JSON text. customer = {name,email,street,postcode,city,country}; items = [{cfg,qty,unit_cents,name,desc}, ...]
  customer             TEXT NOT NULL CHECK (json_valid(customer) AND json_type(customer) = 'object' AND length(customer) <= 2000),
  items                TEXT NOT NULL CHECK (json_valid(items) AND json_type(items) = 'array'
                                            AND json_array_length(items) BETWEEN 1 AND 50 AND length(items) <= 30000),
  total_cents          INTEGER NOT NULL CHECK (total_cents BETWEEN 1 AND 1000000),
  lang                 TEXT CHECK (lang IS NULL OR length(lang) BETWEEN 2 AND 5),
  consent_terms        INTEGER NOT NULL CHECK (consent_terms = 1),
  consent_personalised INTEGER CHECK (consent_personalised IS NULL OR consent_personalised = 1)
);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS login_attempts_at_idx ON login_attempts (at);
