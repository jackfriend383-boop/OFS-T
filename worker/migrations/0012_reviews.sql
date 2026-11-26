-- Round 8: customer reviews added by the owner in the admin "Reviews" tab (shown on the home page and in the configurator).
-- Run once BEFORE deploying the new Worker:
--   npx wrangler d1 execute ofst-orders --remote --file=./migrations/0012_reviews.sql
-- rating : 0 to 5 stars.   photo : optional small picture as a data URL (the admin shrinks it to 480 px). Safe to run again.
CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 0 AND 5),
  comment    TEXT NOT NULL CHECK (length(comment) BETWEEN 1 AND 600),
  photo      TEXT CHECK (photo IS NULL OR length(photo) <= 160000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
