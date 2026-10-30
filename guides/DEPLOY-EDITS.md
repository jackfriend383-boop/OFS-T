# Deploying the admin "Edits" tab (background images)

The new **Edits** tab lets the owner replace the background pictures of the home page and the configurator (light and dark theme) and
choose how they are fitted (Cover / Contain / Stretch, zoom 100-250 %, focal point X/Y).

## 1. Database migration (once, before deploying the Worker)

```bash
cd worker
npx wrangler d1 execute ofst-orders --remote --file=./migrations/0010_site_settings.sql
```

Locally (wrangler dev) use `--local` instead of `--remote`, or run `npm run db:local` which applies the whole `schema.sql` (it also
contains the new `site_settings` table). Safe to run again. Until it is run the public `/api/site-settings` simply returns no slots,
so the site keeps its default pictures.

## 2. Deploy

1. `cd worker && npm run deploy` (new routes, see below).
2. Rebuild and publish the public site and the admin (`npm run build`, `npm run build:admin`) as usual.

No new secret, binding or R2 bucket is needed: the pictures are stored in D1 as base64 (the browser shrinks them to at most 2400 px
wide first; the Worker refuses anything over about 1.5 MB, and checks the file's real type from its first bytes).

## 3. Endpoints

| Route | Auth | What |
| --- | --- | --- |
| `GET /api/site-settings` | public, cached 20 s | `{ slots: { homeLight: { url, size, pos, fit, zoom, x, y, ver }, ... } }` (only slots with a custom picture) |
| `GET /api/site-image/:slot?v=VER` | public, cached 1 year (`immutable`) | the picture bytes; `VER` changes on every save, so caches never serve an old one |
| `PUT /api/admin/site-settings/:slot/image` | admin | raw body, `Content-Type: image/webp|jpeg|png`, up to ~1.5 MB |
| `PUT /api/admin/site-settings/:slot` | admin | JSON `{ fit: cover|contain|stretch, zoom: 100-250, posX: 0-100, posY: 0-100 }` (the slot needs a picture first) |
| `DELETE /api/admin/site-settings/:slot` | admin | back to the default picture |

Slots: `homeLight`, `homeDark`, `confLight`, `confDark`.

## 4. Content-Security-Policy

The public site must be allowed to load pictures from the Worker origin: `img-src 'self' data: blob: <worker origin>`.
`vite.shared.ts` already adds it to the `_headers` file, **but the `<meta>` CSP in `index.html` has `img-src 'self' data: blob:` only**.
Add the API origin there as well (like `__CSP_CONNECT__`). Until then the site still works: `src/lib/siteSettings.ts` notices the
blocked picture (`securitypolicyviolation`) and loads it through a `blob:` address, at the cost of one extra request.
The admin page needs no change (it shows the pictures as `blob:` addresses).

## 5. CSS contract for the site

`src/lib/siteSettings.ts` sets these on `<html>` (and removes them for a slot without a custom picture):
`--bg-home-light`, `--bg-home-dark`, `--bg-conf-light`, `--bg-conf-dark` (`url("...")`), per slot
`--bg-<home|conf>-<light|dark>-size` / `-pos`, and `--bg-home-size`, `--bg-home-pos`, `--bg-conf-size`, `--bg-conf-pos` for the theme
that is active (they follow `data-ofst` on `<html>`). Use them as `var(--bg-home-light, url(default))`, and keep `background-repeat: no-repeat`.
