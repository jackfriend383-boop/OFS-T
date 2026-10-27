-- Round 5: designs managed from the admin "Designs" tab (add, edit, hide, delete) and print masters.
-- Run once BEFORE deploying the new Worker:
--   npx wrangler d1 execute ofst-orders --remote --file=./migrations/0009_designs.sql
-- One row per design the owner added in the admin, OR per built-in design (those in src/data/designs.json) that the owner changed
-- (price, name, hidden...): such a row only overrides the fields it fills in (NULL = keep the built-in value).
-- master  : the design's print master (vector SVG, millimetres, colour slots c1 / c2 + cut line); only admins can read it.
-- art1000 / art1600 : the preview pictures drawn on the car (PNG as base64), made in the browser from the master.
-- ver     : goes up every time the master changes, so browsers fetch the new preview picture.
CREATE TABLE IF NOT EXISTS designs (
  id          TEXT PRIMARY KEY CHECK (length(id) BETWEEN 2 AND 40),
  name        TEXT CHECK (name IS NULL OR length(name) BETWEEN 1 AND 60),
  tag         TEXT CHECK (tag IS NULL OR length(tag) <= 120),
  tag_pt      TEXT CHECK (tag_pt IS NULL OR length(tag_pt) <= 120),
  cat         TEXT CHECK (cat IS NULL OR length(cat) BETWEEN 1 AND 30),
  price       INTEGER CHECK (price IS NULL OR price BETWEEN 1 AND 999),
  c1          TEXT CHECK (c1 IS NULL OR length(c1) <= 20),
  c2          TEXT CHECK (c2 IS NULL OR length(c2) <= 20),
  fixed       INTEGER CHECK (fixed IS NULL OR fixed IN (0, 1)),
  hidden      INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  mode        TEXT CHECK (mode IS NULL OR mode IN ('mask', 'rgb')),
  master      TEXT CHECK (master IS NULL OR length(master) <= 1000000),
  art1000     TEXT CHECK (art1000 IS NULL OR length(art1000) <= 400000),
  art1600     TEXT CHECK (art1600 IS NULL OR length(art1600) <= 400000),
  ver         INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
