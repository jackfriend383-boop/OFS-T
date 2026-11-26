-- Waiting list for customers outside the São Miguel pre-sale (e.g. Portugal mainland).
CREATE TABLE IF NOT EXISTS waitlist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  area       TEXT NOT NULL DEFAULT 'mainland',
  lang       TEXT NOT NULL DEFAULT 'pt',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
