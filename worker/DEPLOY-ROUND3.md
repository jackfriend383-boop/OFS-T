# Deploying rounds 3 and 4 (security, emails, legal texts, no-VAT, promo codes, refunds)

The backend (Worker) changed, so it must go live **before** the website. The new Worker still works with the old website.

Open PowerShell in the `OFS/T` folder:

1. Update the live database (two files, in this order, each only once):
   ```
   cd worker
   npx wrangler d1 execute ofst-orders --remote --file=./migrations/0007_rate_limits_and_email_flag.sql
   npx wrangler d1 execute ofst-orders --remote --file=./migrations/0008_refunds_and_discounts.sql
   ```
   Type `y` when asked. You should see `"success": true` each time. A second run says the column already exists, which is harmless.
2. Deploy the Worker:
   ```
   npx wrangler deploy
   ```
3. In Stripe (Dashboard → Developers → Webhooks → your endpoint → "Select events"), **add** these events next to the four you already have:
   `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`.
   Without them, refunds and chargebacks simply don't show in the admin (nothing breaks).
4. Publish the website:
   ```
   cd ..
   git add -A
   git commit -m "Rounds 3-4: security, emails, legal texts, no VAT, promo codes, refunds"
   git push
   ```

## What to test
- Sign in with a NEW email address: after clicking the email link, the site asks for your date of birth, then you're in.
- Sign in with your existing email: you go straight in.
- Cart: under the total it says "IVA não aplicável – regime de isenção (art. 53.º do CIVA)".
- Place a test order: Stripe's page shows the same no-VAT line under the Pay button and an "Add promotion code" link.
- Pay: the customer gets the payment email (with the no-VAT line, returns info and links), and ADMIN_EMAIL gets "Nova encomenda".
- Admin: the order shows "Para imprimir: 2 × Autocolantes de porta (par) · …".
- In the admin, set that order to "Enviada": the customer gets "O seu kit está a caminho".
- Refund a test payment in Stripe: within a minute the admin order shows "Reembolsado na Stripe" and you get an email.
- Reply to any customer email: it should arrive at geral@ofstdesigns.com (or the email in src/data/site.json).

## Promotion codes
Stripe Dashboard → Product catalogue → Coupons → create a coupon (e.g. 10 % off) → add a customer-facing code (e.g. `AZORES10`).
Customers type it on Stripe's payment page. Avoid 100 % codes: a free order isn't a "paid" order and would not appear in the admin.
