# Security

OFS/T is a React/Vite site, prerendered to static HTML (`src/`, `scripts/prerender.mjs`) and served as static files.
Behind it sit two things you operate yourself:

- **`worker/`** - a Cloudflare Worker (`worker/src/index.ts`) with a D1 database (`worker/schema.sql`). It is the only code that touches the database.
  It handles passwordless customer accounts (emailed one-time links), Stripe Checkout, the Stripe webhook, transactional email (Resend) and the owner API.
- **The owner dashboard** - a separate build (`admin-app/`, `npm run build:admin`) deployed to its own host, `admin.ofstdesigns.com` (noindex, unlinked, strict `_headers`).

Card data never reaches us: payment happens on Stripe's hosted page. The browser calls the Worker only (`apiUrl` in `src/data/site.json`); it cannot reach D1.

## Reporting a vulnerability

Please email **[security contact email]** with a description, the affected URL and steps to reproduce.
Do not open a public issue for security problems. We aim to acknowledge reports within [N] working days.
Please do not access other people's data, run denial-of-service tests or use automated scanners that generate heavy traffic.

## Threat model

| Asset / risk | Exposure | Mitigation |
|---|---|---|
| Visitors' privacy | Any third-party script, font or embed leaks IP/referrer | No third-party requests from the site: fonts self-hosted, no analytics, no CDNs. CSP `default-src 'self'` enforces it; the only extra origin is the Worker (`connect-src`). |
| XSS via URL parameters (`/configurator/?design=…&number=…`) | Query string is attacker-controlled | `sanitizeCfg()` / `cleanNumber()` in `src/lib/kit.ts` validate every field against allowlists (badge text: `A-Z 0-9 space . # & !-`, max 8). The Worker re-validates the same fields (`worker/src/pricing.ts`). |
| Tampering with `localStorage` (cart, customer session) | A user or another script on the origin can edit it | The cart is re-validated on load and never carries prices; prices are always computed by the Worker. The customer session is an opaque random token (only its SHA-256 hash is stored server-side). |
| Script injection | - | CSP `script-src 'self'`: no inline scripts, no `eval`. `dangerouslySetInnerHTML` is used only for first-party content (`src/content/*.html`, generated SVG), never for request/order data. |
| Clickjacking / transport | Site framed by another origin | `frame-ancestors`, HSTS etc. need HTTP headers: `npm run build` writes `dist/_headers` (Cloudflare Pages / Netlify); **GitHub Pages ignores it**, so host on Cloudflare Pages to get them. The Worker sends them on every API response. |
| Secrets in the repo | - | None. `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` are Worker secrets (`wrangler secret put`); local test values live in the git-ignored `worker/.dev.vars`. `.gitignore` also blocks `.env*`, keys, local D1 files and backups. |
| Supply chain | - | `package-lock.json` committed (site and worker), `npm audit` clean, Dependabot opens weekly update PRs (`.github/dependabot.yml`). |
| Forged prices / fake orders | Anyone can call the public API directly | Prices are computed in the Worker from the server-side price list (the browser total is ignored). An order exists only after Stripe's **signed webhook** confirms the exact amount (`amountOk`); retried webhooks are idempotent. Checkout requires a signed-in customer. |
| API abuse / flooding | Scripts hammering endpoints to burn the D1 quota or spam email | Per-IP limits on every call via Cloudflare rate-limit bindings (`RL` 120/min, `RL_STRICT` 15/min for sign-in, account and checkout; `wrangler.jsonc`), plus D1-backed limits on sign-in links, failed admin logins and checkouts, and global caps. Only `CF-Connecting-IP` is trusted for the visitor's address. |
| Admin session theft / brute force | The owner API exposes every order | Random 256-bit bearer token, only its hash stored, 8 h expiry, server-side logout revokes all sessions, constant-time password compare, 8 failed logins per IP per 15 min. Strict CORS allow-list (`ALLOWED_ORIGINS`), no cookies. |
| Stored XSS via admin uploads | Design masters (SVG) are rendered in the dashboard | `checkMaster()` accepts vector shapes only: no scripts, event handlers, `foreignObject`, animation, external `href`, entities or `data:` URIs. |

### Content Security Policy

Set in `index.html` and `admin-app/index.html` as a `<meta http-equiv="Content-Security-Policy">` (and as a header in `dist/_headers`):

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'
```

When the order backend is configured, `vite.config.ts` appends the Worker origin to `connect-src`
(`connect-src 'self' https://ofst-api.YOUR-SUBDOMAIN.workers.dev`) and nothing else. The build refuses a non-https URL
(plain http only for localhost), a URL with a path, or anything that is not a bare origin. No key or password ever goes in `site.json`.

- `style-src 'unsafe-inline'` is needed because markup and JS templates use `style="…"` attributes
  (e.g. colour swatches `style="--c:#…"`, some layout tweaks in React components). It allows inline CSS only, never script.
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

### Status of the Cloudflare order backend

Implemented:
- [x] No secrets in the site or in git. The admin email/password are Worker secrets (`wrangler secret put`); local test values live in the git-ignored `worker/.dev.vars`.
- [x] D1 has no public endpoint: the browser can only call the Worker, which uses prepared (bound) statements only. Orders are validated field by field (same limits as the `CHECK` constraints in `worker/schema.sql`); extra customer keys, bad types and oversized bodies are rejected.
- [x] Admin identity is a random 256-bit bearer token issued after a correct password (constant-time compare); only its SHA-256 hash is stored, with an 8-hour expiry. Never read from a request body.
- [x] Server-side sign-out (`POST /api/admin/logout` deletes every session); session in `sessionStorage`, gone when the tab closes.
- [x] CORS allow-list (`ALLOWED_ORIGINS`): requests from any other website origin are refused. Bearer tokens, no cookies.
- [x] Throttling: 10 failed sign-ins per 15 minutes (global) and a global 30-orders-per-10-minutes cap.
- [x] Client-side validation and sanitising, friendly error messages (server text never shown verbatim).
- [x] Data minimisation: name, email, street, postcode, city, country; consent flags stored with the order. User agent not sent.
- [x] No uploads. Admin page `noindex,nofollow`, not linked, not in the sitemap or `llms.txt`.

Still to do:
- [x] Payments (hosted checkout) with **verified webhooks** and server-side prices; promotion-code discounts are checked against Stripe's subtotal; refunds and disputes are recorded from the webhook.
- [ ] Order confirmation emails (needs an email provider called from the Worker; durable-medium requirement, see `LEGAL-TODO.md`).
- [x] Per-IP rate limiting on every API call (Cloudflare rate-limit bindings).
- [ ] CAPTCHA on sign-in-link requests and admin login
      (Cloudflare Turnstile verified inside the Worker), and Cloudflare Access in front of dmin.ofstdesigns.com.
- [ ] Policy version/date stored with the consent flags; 2FA on the Cloudflare account; regular encrypted exports (`wrangler d1 export`; D1 also has 30-day Time Travel restore).
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
- [x] Mark orders paid only from the verified webhook, not from the browser redirect.

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
- [ ] **Data minimisation**: collect only name, email, shipping address and country (plus phone only if the carrier needs it). For customer accounts, collect date of birth only for the minimum-age check; no account is required to buy.
- [ ] **Consent logging**: when a form has a consent checkbox (terms/privacy acceptance, marketing opt-in), store what was agreed, the policy version/date, the timestamp and the order/user id. Marketing consent must be a separate, unticked opt-in.
- [ ] Retention: delete or anonymise data after the periods in the privacy policy; keep invoices 10 years as required.
- [ ] Data processing agreements with every processor (host, database, email, payments, carrier); record of processing activities.
- [ ] Update `privacy.html`, `cookies.html` and the CSP when any third party or cookie is added; ask for consent before any non-essential cookie/analytics.
- [ ] Backups encrypted; access to production limited, with 2FA on every admin account (GitHub, host, Supabase, Stripe, email, domain registrar).
- [ ] Breach procedure: notify the CNPD within 72 hours where required.
