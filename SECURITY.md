# Security

OFS/T is a pre-rendered static site (built by Vite from `src/` (prerendered into `dist/`), served by GitHub Pages).
The only backend is an **optional Supabase project** for orders (see `SUPABASE-SETUP.md`, `supabase/schema.sql`,
`src/lib/backend.ts`). When `supabaseUrl`/`supabaseAnonKey` in `src/data/site.json` are empty (the default) nothing is
sent anywhere: the checkout tells the visitor to order by email. There are no customer accounts, uploads, payments,
analytics, embeds or reviews. One owner account signs in at `/admin/` (noindex, unlinked) to read orders.

## Reporting a vulnerability

Please email **[security contact email]** with a description, the affected URL and steps to reproduce.
Do not open a public issue for security problems. We aim to acknowledge reports within [N] working days.
Please do not access other people's data, run denial-of-service tests or use automated scanners that generate heavy traffic.

## Threat model (current static site)

| Asset / risk | Exposure | Mitigation |
|---|---|---|
| Visitors' privacy (tracking, third-party requests) | Any external script, font, image or embed leaks IP/referrer to a third party | No third-party requests at all: fonts self-hosted (`assets/fonts/`), no analytics, no CDNs. CSP `default-src 'self'` enforces it. `Referrer-Policy: strict-origin-when-cross-origin` via meta. |
| XSS via URL parameters (`/configurator/?design=…&number=…`) | Query string is attacker-controlled | `sanitizeCfg()` in `assets/js/core.js` validates every field against allowlists (design id must exist, colours must be known keys, finish/kit/model enumerated); badge text passes through `cleanNumber()` (uppercase `A-Z 0-9 space . # & ! -`, max 8 chars). Dynamic text inserted with `innerHTML` is passed through `esc()` (escapes `& < > "`). |
| XSS / tampering via `localStorage` (`amig-cart`) | Another script on the origin, or a user, can edit it | Cart is re-validated with `sanitizeCfg()` on every load; quantities clamped to 1–99. Prices are always recomputed from `designs.json`, never read from storage. It is the visitor's own data on their own device. |
| Script injection in general | — | CSP `script-src 'self'`: no inline scripts, no `eval`, no inline event handlers (`tools/check.py` fails the build if any appear). JSON-LD blocks are data (`type="application/ld+json"`), which CSP does not execute. |
| Clickjacking | Site framed by another origin | Needs `frame-ancestors 'none'` / `X-Frame-Options: DENY` as an HTTP header (cannot be set via meta; GitHub Pages cannot set headers, see below). Low impact today: no state-changing actions. |
| Secrets in the repo | — | None exist. No API keys, tokens or credentials are needed to build or run the site. Keep it that way (see checklist). |
| Supply chain | — | Build uses npm packages (React, React Router, Vite, TypeScript); commit package-lock.json and run `npm audit` regularly. Fonts were downloaded once from Google Fonts and committed. |
| Fake / tampered orders (backend on) | Anyone can call the public insert API directly, with any payload | RLS insert policy + table constraints (allowed customer keys only, size limits, email shape, total 1–1 000 000 cents, terms consent required); status/created_at forced by trigger and not even granted as insertable columns; global flood cap (30 orders / 10 min). **The total is computed in the browser from `designs.json` and can be forged:** the admin dashboard recomputes it from the price list and warns on mismatch, and the owner must verify totals before asking for payment. |
| Stored XSS in the admin dashboard | Order rows are attacker-controlled | `admin.js` re-validates every kit with `sanitizeCfg()`, escapes all text with `esc()`, allowlists status values and uuids; nothing from a row is used as HTML or as a URL. |
| Order data / admin session theft | — | Only an admin (row in `admins`, matched by `auth.uid()` from the JWT) can select/update orders, and only the `status` column is updatable; no delete grant. Session tokens live in `sessionStorage` (per tab), refreshed when expired; sign-out calls `/auth/v1/logout?scope=global` (revokes refresh tokens server-side). |

### Content Security Policy

Set in `src/templates/base.html` as a `<meta http-equiv="Content-Security-Policy">`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'
```

When the order backend is configured, `vite.config.ts` appends the Supabase origin to `connect-src`
(`connect-src 'self' https://YOURPROJECT.supabase.co`) and nothing else. The build also refuses a non-https/odd URL
and any key that is not an anon/publishable key (it rejects `sb_secret_…` and JWTs whose role is not `anon`).

- `style-src 'unsafe-inline'` is needed because markup and JS templates use `style="…"` attributes
  (e.g. colour swatches `style="--c:#…"`, some layout tweaks in templates and in `core.js`). It allows inline CSS only, never script.
  To remove it, move those attributes into classes / CSS custom properties set through `element.style` (CSSOM is not blocked by CSP).
- `img-src data: blob:` covers inline SVG data URIs and any canvas/blob previews.
- `frame-ancestors`, `report-uri`/`report-to` and `sandbox` are ignored in a meta tag; set them as headers.

### Verifying there are no third-party requests

After `npm run build`, search `dist/` for `src=`/`href=` attributes pointing to `http(s)://`.
Expected matches only: `<link rel="canonical">`, `og:url`/`og:image`/`twitter:image` (own domain), JSON-LD `@context`/URLs,
and outbound legal links that the visitor clicks (`livroreclamacoes.pt`, `cnpd.pt`, `cniacc.pt`, `consumidor.gov.pt`).
`car.js` contains the SVG namespace string `http://www.w3.org/2000/svg`, which is an identifier, not a request.

## Recommended HTTP headers

GitHub Pages **cannot set custom response headers**. It does serve HTTPS (enable "Enforce HTTPS" in the repo settings)
and sends HSTS on `*.github.io`. For full control, put the site behind a host or proxy that supports headers,
e.g. Cloudflare Pages, Netlify (both read a `_headers` file) or Cloudflare in front of a custom domain (Transform Rules).

Example `_headers` (Netlify / Cloudflare Pages), placed in the published folder:

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin

/assets/fonts/*
  Cache-Control: public, max-age=31536000, immutable
```

Only add `preload` to HSTS once every subdomain serves HTTPS. When a payment provider is added,
relax `Permissions-Policy: payment=` and add the provider's domains to `script-src`, `frame-src` and `connect-src` as its docs require.

## When you add a backend: checklist

Go through every item before taking real orders or storing customer data.

### Status of the Supabase order backend

Implemented:
- [x] Only the public anon/publishable key in the site (build refuses secret/service_role keys); no secrets in git.
- [x] RLS enabled on `orders` and `admins`; separate insert / select / update policies; no delete policy; table privileges
      revoked and re-granted per column (customers may insert only the order columns; admins may update only `status`).
- [x] Identity from the verified JWT only (`auth.uid()` in `is_admin()`), never from request bodies.
- [x] Server-side sign-out (`/auth/v1/logout?scope=global`); session in `sessionStorage`, refreshed before expiry.
- [x] Server-side input validation (constraints + policy checks), client-side validation and sanitising, friendly
      error messages (server text never shown verbatim).
- [x] Data minimisation: name, email, street, postcode, city, country; consent flags stored with the order. User agent not sent.
- [x] No uploads. Admin page `noindex,nofollow`, not linked, not in the sitemap or `llms.txt`.

Still to do:
- [ ] Payments (hosted checkout) with **verified webhooks** and server-side prices; until then the owner verifies totals by hand.
- [ ] Order confirmation emails (needs an Edge Function or email provider; durable-medium requirement, see `LEGAL-TODO.md`).
- [ ] Stronger abuse protection for order inserts: per-IP rate limiting and a CAPTCHA (e.g. Cloudflare Turnstile verified in
      a Supabase Edge Function, with inserts then allowed only from that function). Today there is only Supabase's built-in
      Auth rate limiting and the global 30-orders-per-10-minutes cap.
- [ ] Policy version/date stored with the consent flags; 2FA on the Supabase account; regular encrypted exports (free plan has no backups).
- [ ] HTTP headers (`frame-ancestors`, HSTS) via a host that supports them.

### Secrets and keys
- [ ] **Never ship secret keys to the client.** Only public/publishable keys go in front-end code (Supabase `anon`/publishable key, Stripe `pk_…`). The Supabase `service_role` key, Stripe `sk_…`, webhook secrets and SMTP passwords live only in server-side environment variables / secret stores.
- [ ] No secrets in git (add `.env*` to `.gitignore`; enable secret scanning / push protection). Rotate any key that was ever committed.
- [ ] Separate test and live keys; restrict API keys by permission and, where possible, by domain/IP.

### Authentication and authorisation (e.g. Supabase)
- [ ] **Row Level Security enabled on every table** (including new ones, views via `security_invoker`, and storage buckets). No table without policies.
- [ ] Policies keyed on `auth.uid()` (e.g. `using (user_id = auth.uid())` and `with check (user_id = auth.uid())`); separate policies for select/insert/update/delete.
- [ ] **Derive the user id from the server-side session / verified JWT**, never from a request body, query string or hidden field. Ignore any `user_id`/`role`/`price` the client sends.
- [ ] **Server-side sign-out**: revoke the session and refresh tokens on logout (e.g. `supabase.auth.signOut({ scope: 'global' })` or the admin API), not just deleting the token in the browser. Revoke sessions on password change.
- [ ] Short-lived access tokens; refresh tokens rotated; cookies `HttpOnly; Secure; SameSite=Lax` if sessions use cookies; CSRF protection for cookie-authenticated state-changing requests.
- [ ] Admin functions only in server code / edge functions behind role checks.

### Payments (e.g. Stripe)
- [ ] Use hosted checkout or Payment Elements; card data never touches our servers (keeps PCI scope at SAQ A).
- [ ] **Compute prices on the server** from the product catalogue; never trust amounts from the client.
- [ ] **Verify webhook signatures** with the endpoint secret against the **raw request body** (e.g. `stripe.webhooks.constructEvent(rawBody, sigHeader, endpointSecret)`); reject on failure; enforce the timestamp tolerance.
- [ ] **Idempotency**: store processed `event.id`s and ignore duplicates; use idempotency keys on outgoing API calls; make order fulfilment idempotent.
- [ ] Mark orders paid only from the verified webhook, not from the browser redirect.

### File uploads (e.g. custom artwork)
- [ ] **Allowlist** both MIME type (checked server-side by content / magic bytes, not the client's `Content-Type`) and extension, e.g. `.png .jpg .jpeg .pdf` (and `.ai/.eps` only if really needed).
- [ ] **Reject** `.php .phtml .jsp .asp(x) .html .htm .svg .xml .js .exe` and double extensions (`file.php.png`). SVG can carry scripts: refuse it or sanitise and re-serialise it server-side.
- [ ] **Store outside the web root** / in a private bucket; serve through signed, short-lived URLs with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
- [ ] **Random file names** (UUIDs); never use the user's file name in the path.
- [ ] **Size limits** (e.g. 20 MB) enforced by the server/bucket, plus limits on image dimensions/page count; virus-scan if possible; strip metadata.

### XSS and injection
- [ ] Escape all user content on output (context-aware: HTML, attribute, URL, JS); use `textContent` rather than `innerHTML` for user data; sanitise any rich text with a maintained sanitiser (e.g. DOMPurify).
- [ ] Keep the CSP; add new third-party origins explicitly and narrowly; consider nonces/hashes and remove `'unsafe-inline'` for styles.
- [ ] Parameterised queries only; validate every input server-side (types, lengths, allowlists) even when the browser validates too.

### Abuse protection
- [ ] **Rate limiting** on login, sign-up, password reset, checkout, contact/upload endpoints (per IP and per account); CAPTCHA-free alternatives first (honeypot fields, time checks).
- [ ] Generic error messages (no user enumeration); log and alert on repeated failures.

### Privacy and compliance
- [ ] **Data minimisation**: collect only name, email, shipping address and country (plus phone only if the carrier needs it). No date of birth, no account required to buy.
- [ ] **Consent logging**: when a form has a consent checkbox (terms/privacy acceptance, marketing opt-in), store what was agreed, the policy version/date, the timestamp and the order/user id. Marketing consent must be a separate, unticked opt-in.
- [ ] Retention: delete or anonymise data after the periods in the privacy policy; keep invoices 10 years as required.
- [ ] Data processing agreements with every processor (host, database, email, payments, carrier); record of processing activities.
- [ ] Update `privacy.html`, `cookies.html` and the CSP when any third party or cookie is added; ask for consent before any non-essential cookie/analytics.
- [ ] Backups encrypted; access to production limited, with 2FA on every admin account (GitHub, host, Supabase, Stripe, email, domain registrar).
- [ ] Breach procedure: notify the CNPD within 72 hours where required.
