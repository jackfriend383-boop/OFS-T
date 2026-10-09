-- =====================================================================================================
-- OFS/T order database for Cloudflare D1 (SQLite). Safe to re-run: every statement uses IF NOT EXISTS and
-- no data is dropped.
--   Local test : npm run db:local     (inside worker/)
--   Production : npm run db:remote
--
-- Model
--   pending_checkouts : a checkout in progress (customer is on Stripe's page). Deleted on cancel / expiry / failure.
--   orders          : one row per PAID order. Created ONLY by the Worker when Stripe's signed webhook confirms the payment
--                     (copied from pending_checkouts). Every field was validated when the checkout started.
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
  consent_personalised INTEGER CHECK (consent_personalised IS NULL OR consent_personalised = 1),
  -- Payment (Stripe Checkout). An order is created 'unpaid' when checkout starts and is marked 'paid' ONLY by the
  -- signed Stripe webhook, after the amount received has been compared with total_cents.
  payment_status       TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'failed', 'expired', 'mismatch')),
  stripe_session_id    TEXT,
  paid_at              TEXT,
  user_id              TEXT,  -- customer account (users.id) when the buyer was signed in
  invoice_sent_at      TEXT,
  paid_email_sent_at   TEXT,  -- when the payment confirmation email was sent
  payment_intent       TEXT,  -- Stripe payment id (refunds and disputes are matched on it)
  paid_cents           INTEGER CHECK (paid_cents IS NULL OR paid_cents BETWEEN 0 AND 1000000), -- amount paid after any promotion code
  refund_status        TEXT CHECK (refund_status IS NULL OR refund_status IN ('partial', 'refunded', 'disputed', 'dispute_won', 'dispute_lost')),
  refunded_cents       INTEGER
);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_stripe_session_idx ON orders (stripe_session_id);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_payment_intent_idx ON orders (payment_intent);
-- (An older database without the payment columns: run migrations/0002_payments.sql first, then this file.)

-- Checkouts in progress (same checks as orders). Moved into orders by the Stripe webhook once paid. See migrations/0005.
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


-- Customer accounts. Passwordless: a customer proves they own an email address by clicking a one-time link we send.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY CHECK (length(id) = 36),
  email         TEXT NOT NULL UNIQUE CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  birth_date    TEXT CHECK (birth_date IS NULL OR birth_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at TEXT,
  name          TEXT CHECK (name IS NULL OR length(name) <= 200),
  phone         TEXT CHECK (phone IS NULL OR length(phone) <= 40),
  street        TEXT CHECK (street IS NULL OR length(street) <= 300),
  postcode      TEXT CHECK (postcode IS NULL OR length(postcode) <= 20),
  city          TEXT CHECK (city IS NULL OR length(city) <= 120),
  country       TEXT CHECK (country IS NULL OR length(country) <= 60),
  lang          TEXT CHECK (lang IS NULL OR length(lang) BETWEEN 2 AND 5)
);

-- One-time sign-in links (only the SHA-256 hash of the token is stored) and the log used to throttle requests for them.
CREATE TABLE IF NOT EXISTS login_links (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  birth_date TEXT CHECK (birth_date IS NULL OR birth_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE TABLE IF NOT EXISTS link_requests (
  email TEXT NOT NULL,
  at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS link_requests_at_idx ON link_requests (at);

CREATE TABLE IF NOT EXISTS customer_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_sessions_user_idx ON customer_sessions (user_id);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

-- Short-lived per-visitor counters for rate limits (keys like "link:<ip>"); rows older than a day are deleted automatically.
CREATE TABLE IF NOT EXISTS rate_hits (
  key TEXT NOT NULL CHECK (length(key) <= 100),
  at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS rate_hits_key_at_idx ON rate_hits (key, at);

CREATE TABLE IF NOT EXISTS login_attempts (
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS login_attempts_at_idx ON login_attempts (at);
