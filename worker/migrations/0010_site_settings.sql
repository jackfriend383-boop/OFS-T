-- Round 6: "Edits" tab in the admin. First feature: background images for the home page and the configurator (light + dark).
-- Run once BEFORE deploying the new Worker (locally: add --local instead of --remote):
--   npx wrangler d1 execute ofst-orders --remote --file=./migrations/0010_site_settings.sql
-- One row per slot that has a custom picture (no row = the site's default picture). Safe to run again.
-- slot    : homeLight | homeDark | confLight | confDark
-- mime    : image/webp | image/jpeg | image/png (checked against the file's first bytes by the Worker)
-- data    : the picture as base64 (the browser shrinks it to at most 2400 px wide first; the Worker refuses more than ~1.5 MB)
-- fit     : cover | contain | stretch     zoom: 100-250 (only used with cover)     pos_x / pos_y: focal point, 0-100 %
-- ver     : goes up with every change, so browsers fetch the new picture instead of an old cached one.
CREATE TABLE IF NOT EXISTS site_settings (
  slot        TEXT PRIMARY KEY CHECK (slot IN ('homeLight', 'homeDark', 'confLight', 'confDark')),
  mime        TEXT NOT NULL CHECK (mime IN ('image/webp', 'image/jpeg', 'image/png')),
  data        TEXT NOT NULL CHECK (length(data) <= 2200000),
  fit         TEXT NOT NULL DEFAULT 'cover' CHECK (fit IN ('cover', 'contain', 'stretch')),
  zoom        INTEGER NOT NULL DEFAULT 100 CHECK (zoom BETWEEN 100 AND 250),
  pos_x       INTEGER NOT NULL DEFAULT 50 CHECK (pos_x BETWEEN 0 AND 100),
  pos_y       INTEGER NOT NULL DEFAULT 50 CHECK (pos_y BETWEEN 0 AND 100),
  ver         INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
