# Turning on online orders (Cloudflare D1)

The website is static (GitHub Pages). Orders are stored in a **Cloudflare D1** database that only you can read. The
browser cannot reach D1 directly, so a small **Worker** (`worker/`) sits in front of it: it validates orders, and it
checks your admin password for `/admin/`. Both run on Cloudflare's free plan.

Until `apiUrl` is set in `src/data/site.json`, the checkout says *"Online ordering isn't set up yet — email us"* and
`/admin/` shows short setup instructions. No payment is taken online: you email the customer to confirm payment and delivery.

```
browser (GitHub Pages)  ──►  Worker  ofst-api  (validates, checks your password)  ──►  D1 database  ofst-orders
```

You need a free Cloudflare account (<https://dash.cloudflare.com/sign-up>) and Node 20+. All commands run inside `worker/`.

## 1. Install and log in

```bash
cd worker
npm install
npx wrangler login
```

`wrangler login` opens a browser tab; click **Allow**. Check with `npx wrangler whoami`.

## 2. Create the database

```bash
npx wrangler d1 create ofst-orders
```

It prints a `database_id`. Open `worker/wrangler.jsonc` and replace `00000000-0000-0000-0000-000000000000` with it.
(If wrangler offers to add the binding for you, say yes, but keep the binding name `DB`.)

To keep customer data in the EU, add `--jurisdiction eu` to the create command above (it cannot be changed later).

## 3. Create the tables

```bash
npm run db:remote
```

Safe to run again; it never deletes data. Check: `npx wrangler d1 execute ofst-orders --remote --command "SELECT name FROM sqlite_master WHERE type='table'"`
should list `orders`, `admin_sessions` and `login_attempts`.

## 4. Set your admin login (secrets, never in git)

```bash
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD
```

Each command asks you to type the value. Use a long, unique password (**12+ characters**, a passphrase from your password
manager is ideal); shorter ones are refused by the API. Change it any time by running the command again, then sign out
everywhere with the *Terminar sessão* button.

## 5. Allow your website and publish the API

In `worker/wrangler.jsonc`, set `ALLOWED_ORIGINS` to your site's **origin** (no path, no trailing slash), e.g.
`"https://ofstdesigns.com"`. Only these websites may
call the API. Then:

```bash
npm run deploy
```

It prints the address, like `https://ofst-api.YOUR-SUBDOMAIN.workers.dev`. Test it: opening `…/api/health` in a browser
should show `{"ok":true}`.

## 6. Connect the website

1. In `src/data/site.json` set `"apiUrl": "https://ofst-api.YOUR-SUBDOMAIN.workers.dev"` (the bare address, no path).
2. Make sure `"email"` is your real contact address (customers see it if anything fails).
3. `npm run build` in the project root, then commit and push. The build adds that address to the page's Content-Security-Policy.

## 7. Using it

- Open `https://YOUR-SITE/admin/` and sign in with the email and password from step 4.
- Each order shows the customer, the kits with a print-mold preview, **Download PNG** / **SVG + cut line**, and a button
  that moves it New → Printed → Shipped.
- **Always check the total** against your price list before asking for payment: the website runs in the customer's browser,
  so the total in an order can be tampered with. The dashboard warns when it differs from the list price.
- Sessions last 8 hours and live only in that browser tab.

## Test locally first (optional)

```bash
echo ADMIN_EMAIL=owner@example.test> .dev.vars      # PowerShell/cmd; use any test values, the file is git-ignored
echo ADMIN_PASSWORD=some-test-password-123>> .dev.vars
npm run db:local
npm run dev                                          # API on http://localhost:8787
```

In another terminal, set `"apiUrl": "http://localhost:8787"` temporarily in `site.json` and run `npx vite` in the project root
(`http://localhost:5173` is already in `ALLOWED_ORIGINS`). Put `apiUrl` back to the real address before building for release.

## Backups, retention and privacy

- D1 has **Time Travel**: restore the database to any minute in the last 30 days
  (`npx wrangler d1 time-travel restore ofst-orders --timestamp=…`). For your own copy:
  `npx wrangler d1 export ofst-orders --remote --output=orders-backup.sql`. Keep exports encrypted.
- Delete or anonymise old orders after the retention period in your privacy policy, e.g.
  `npx wrangler d1 execute ofst-orders --remote --command "DELETE FROM orders WHERE created_at < '2025-01-01'"`.
- **GDPR:** Cloudflare stores your customers' data on your behalf (processor). Accept the Cloudflare DPA, use the EU
  jurisdiction (step 2), and list Cloudflare in the privacy policy (see `LEGAL-TODO.md`).
- Spam protection: the API rejects more than 30 orders in 10 minutes and more than 10 failed sign-ins in 15 minutes
  (constants at the top of `worker/src/index.ts`). For stronger protection add Cloudflare Turnstile / Rate Limiting rules.

## Troubleshooting

| You see | Do this |
|---|---|
| Checkout still says "isn't set up yet" | `apiUrl` is empty, or you didn't rebuild and push. |
| Build stops with "apiUrl must look like …" | Use the bare `https://…workers.dev` address: no path, no trailing text. |
| Browser console: CORS error / "Failed to fetch" | `ALLOWED_ORIGINS` in `wrangler.jsonc` doesn't match the site's origin exactly (check `https`, no trailing `/`), or you didn't `npm run deploy` after editing it. |
| "Email or password is incorrect" | Re-run `wrangler secret put ADMIN_EMAIL` / `ADMIN_PASSWORD`. The email is not case-sensitive. |
| Sign-in says the service isn't configured | The secrets are missing or the password is under 12 characters. |
| "Too many attempts" | Wait 15 minutes (sign-in) or 10 minutes (orders). |
| `wrangler d1 execute` says "no such table" | You ran `db:local` but are checking `--remote` (or vice versa). Run `npm run db:remote`. |
| Orders fail with "Some order details were rejected" | Check live logs: `npx wrangler tail`. |
