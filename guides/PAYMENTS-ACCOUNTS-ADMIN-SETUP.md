# Stripe payments, customer accounts and the admin subdomain: setup

Do these once, in order. Secrets are typed into `wrangler secret put` (inside `worker/`) and never go in git. Use Stripe **test mode** first.

## 1. Database
New database: `npm run db:remote`. Existing database (created before payments): run
`npx wrangler d1 execute ofst-orders --remote --file=./migrations/0002_payments.sql` **first**, then `npm run db:remote`.

## 2. Stripe
1. Create/open your Stripe account. In test mode copy the **secret key** (`sk_test_...`).
2. `npx wrangler secret put STRIPE_SECRET_KEY`
3. Deploy the Worker (`npm run deploy`), note its address (`https://ofst-api.<you>.workers.dev`).
4. Stripe Dashboard -> Developers -> Webhooks -> Add endpoint: `https://<worker address>/api/stripe/webhook`.
   Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`.
5. Copy the endpoint's **signing secret** (`whsec_...`): `npx wrangler secret put STRIPE_WEBHOOK_SECRET`.
6. Stripe Dashboard -> Settings -> Payment methods: enable the ones you want (cards, MB WAY, ...). They appear on Stripe's page automatically.
7. Test with card `4242 4242 4242 4242`. An order only turns "paid" (and shows in the admin) after the webhook arrives.
8. Going live: repeat with live keys (`sk_live_...` and a live webhook endpoint).

Prices are always calculated by the Worker from `src/data/designs.json`; the browser's total is ignored. Shipping is not charged yet.

## 3. Sign-in emails and order emails (Resend)
1. Create a free Resend account, add and verify `ofstdesigns.com` (it gives you DNS records to add).
2. Create an API key: `npx wrangler secret put RESEND_API_KEY`.
3. `MAIL_FROM` in `worker/wrangler.jsonc` must use that verified domain.

## 4. Connect the site
Put the Worker address in `src/data/site.json` -> `apiUrl`, commit and push (the public site redeploys on GitHub Pages).

## 5. Admin on admin.ofstdesigns.com (Cloudflare Pages)
The dashboard is a separate build (`npm run build:admin` -> `dist-admin/`) and is no longer part of the public site.
1. Cloudflare Dashboard -> Workers & Pages -> Create -> Pages -> connect the GitHub repo `OFS-T`.
2. Root directory: `OFS/T`. Build command: `npm ci && npm run build:admin`. Output directory: `dist-admin`.
3. Custom domains -> add `admin.ofstdesigns.com` (if the domain's DNS is on Cloudflare this is automatic; otherwise add the CNAME it shows).
4. `ALLOWED_ORIGINS` already lists `https://admin.ofstdesigns.com`; redeploy the Worker if you changed it.
5. Sign in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` secrets. For extra protection, put **Cloudflare Access** (Zero Trust, free) in front of `admin.ofstdesigns.com` so only your email can even load the page.

## Local development
`npm run dev` (site, :5173), `npm run dev:admin` (admin, :5174), `cd worker && npm run dev` (API, :8787; use a `worker/.dev.vars` file for the secrets above).
