# Turning on online orders (Supabase)

The website is static (GitHub Pages). Orders are stored in a free **Supabase** database that only you can read.
Until you do the steps below, the checkout says *"Online ordering isn't set up yet — email us at …"* (the email from
`src/data/site.json`), and `/admin/` shows these instructions. No payment is taken online either way: you email the
customer to confirm payment and delivery.

You need about 15 minutes. You do not need to install anything.

## 1. Create the project

1. Go to <https://supabase.com>, sign up, and click **New project**.
2. Name it (e.g. `ofst-orders`), choose a strong database password (store it in your password manager), and pick an
   **EU region, e.g. Frankfurt (eu-central-1)**. Free plan is fine.
3. Wait until the project is ready. Turn on two-factor authentication for your Supabase account (Account → Security).

## 2. Create the tables and security rules

1. In the left menu open **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` from this repository, copy **all** of it, paste it, and click **Run**. It should say "Success".
   (Running it again later is safe.)

This creates the `orders` and `admins` tables with Row Level Security: visitors can only *add* an order; only admins can
read orders or change their status; nobody can delete through the website.

## 3. Lock down sign-in and create your admin account

1. **Authentication → Sign In / Providers** (called *Providers* / *Settings* in some versions): turn **off**
   "Allow new users to sign up". Only you should have an account.
2. **Authentication → Users → Add user → Create new user**: your email and a strong, unique password.
   Tick **Auto Confirm User**.
3. Click the new user and copy its **User UID** (looks like `1b2c3d4e-....`).
4. Back in **SQL Editor**, run (with your UID):

   ```sql
   insert into public.admins (user_id) values ('PASTE-YOUR-USER-UID-HERE');
   ```

Any account that is not in `admins` sees "This account isn't an admin" and no orders.

## 4. Connect the website

1. **Project Settings → API** (or **Data API** / **API Keys**). Copy:
   - **Project URL**, e.g. `https://abcdefghijkl.supabase.co`
   - the **anon public** key (starts with `eyJ…`) or the newer **publishable** key (starts with `sb_publishable_…`).
2. Put them in `src/data/site.json`:

   ```json
   "supabaseUrl": "https://abcdefghijkl.supabase.co",
   "supabaseAnonKey": "eyJ...or sb_publishable_..."
   ```

3. Also make sure `"email"` in `site.json` is your real contact address (customers see it if anything fails).
4. Run `npm run build`, then commit and push. The build adds your Supabase address
   to the page's Content-Security-Policy automatically.

**About the key:** the anon/publishable key is *meant* to be public. It only lets visitors do what the security rules
allow (add an order). **Never put the `service_role` key or any `sb_secret_…` key in the site or in git** — it bypasses
all security rules. The build refuses to run if it detects one.

## 5. Using it

- Open `https://YOUR-SITE/admin/` (not linked anywhere, not indexed by search engines) and sign in.
- Each order shows the customer, the kits with a print-mold preview, **Download PNG** (6000 px, transparent) and
  **SVG + cut line** (magenta `CutContour` layer for the plotter), and a button to move it New → Printed → Shipped.
- **Always check the total** against your price list before asking for payment. The dashboard recomputes it and
  warns you when the submitted total differs, but the website runs in the customer's browser and can be tampered with.
- Signing out revokes your session on the server. The session only lives in that browser tab.
- You can also see and export orders in Supabase: **Table Editor → orders** (export as CSV from there).

## 6. Backups, retention and privacy

- The free plan has no downloadable automatic backups. Export the `orders` table as CSV regularly (Table Editor →
  export), or upgrade to a paid plan for daily backups. Keep exports encrypted.
- Delete or anonymise old orders after the retention period in your privacy policy (Table Editor or SQL).
- **GDPR:** Supabase stores your customers' data on your behalf, so it is a *processor*. Accept Supabase's Data
  Processing Addendum (in the dashboard / legal pages), keep the project in the EU, and list Supabase in the privacy
  policy (see `LEGAL-TODO.md`).
- Spam protection: Supabase limits sign-in attempts, and the database rejects more than 30 orders in 10 minutes
  (change `max_orders_per_10_min` in `schema.sql` if needed). See `SECURITY.md` for stronger options.

## Troubleshooting

| You see | Do this |
|---|---|
| Checkout still says "isn't set up yet" | `supabaseUrl`/`supabaseAnonKey` empty, or you didn't rebuild and push. |
| Build stops with "SECRET key" / "role 'service_role'" | You copied the wrong key. Use the anon/publishable key. |
| "Email or password is incorrect" | Check the user exists in Authentication → Users and is confirmed. |
| "This account isn't an admin" | Step 3.4: insert the user's UID into `admins`. |
| Orders fail with "Some order details were rejected" | Run `schema.sql` again; check the Supabase logs (Logs → API). |
