# Deploying round 2 (sign-in to buy, NIF, orders saved only when paid)

What changes for customers and for you:

- **Sign in to buy.** A visitor who presses "Add to cart" without being signed in is taken to the sign-in page. After they click the link in the email, the kit is added to their cart and they are taken back to the page they were on, with the cart open. The checkout also asks guests to sign in.
- **NIF field.** The checkout has an optional "NIF" box. If it is filled in, it must be a valid Portuguese tax number (9 digits). It shows in the admin under the customer's address and in the Invoices tab, and in the CSV export.
- **No more cancelled orders in the database.** While the customer is on the Stripe payment page, the order is kept as a *draft* in a separate table (`pending_checkouts`). It only becomes a real order (in `orders`) when Stripe confirms the payment. If the customer presses "back" on Stripe, cancels or never pays, the draft is deleted.

## Order matters

The new Worker (the backend) must go live **before** the new website. The new Worker still accepts orders from the old website, so there is no broken moment if you follow this order. Do it all in one sitting.

> Before you start: commit your work in git, so you can go back if something goes wrong.
> Suggested message: `Round 2: sign-in to buy, NIF, save orders only when paid`

Open **PowerShell** (or the VS Code terminal) in the project folder, then:

### 1. Add the new table to the live database

```powershell
cd worker
npx wrangler d1 execute ofst-orders --remote --file=./migrations/0005_pending_checkouts.sql
```

It asks you to confirm: type `y` and press Enter. You should see `"success": true`. Running it twice does no harm.

### 2. Deploy the new Worker

Still inside the `worker` folder:

```powershell
npx wrangler deploy
```

At the end it prints the Worker's address. Quick check: open `https://<that address>/api/health` in your browser. It should show `{"ok":true}`.

### 3. (Optional) Remove the old unpaid orders

The old Worker saved an order as soon as someone opened the Stripe page, so the database has some "unpaid", "expired" and "failed" rows. They were never shown in the admin, but you can delete them. **Wait at least one day after step 2** first, and check in the Stripe Dashboard (Payments) that no Multibanco payment is still waiting to be paid. Then:

```powershell
npx wrangler d1 execute ofst-orders --remote --file=./migrations/0006_cleanup_unpaid.sql
```

Paid orders (and "mismatch" ones, which need checking by hand) are never touched.

### 4. Only now: publish the website

Go back to the project folder and push the site as usual:

```powershell
cd ..
git add -A
git commit -m "Round 2: sign-in to buy, NIF, save orders only when paid"
git push
```

Wait for the GitHub build to finish (the green tick in the repository's Actions tab).

## How to test

Use Stripe **test mode** if it is set up (test secret key `sk_test_...` in the Worker and a test webhook). If the live keys are already in use, test with a real small order and refund it in Stripe afterwards.

1. **Sign-in gate.** In a private browser window (not signed in) open the configurator and press "Add to cart". You should land on the sign-in page with a short message explaining why. Enter your email, open the link from the email *in the same browser*. You should go back to the configurator with the same kit, and the cart should open with the kit inside.
2. **Shop quick add.** Same as above from the Shop page ("Quick add"): you come back to the Shop with the cart open.
3. **NIF.** In the checkout, type `123456780` in NIF and press "Place order": you should see an error under the box. Type `123456789` (a valid test number) or leave it empty: it is accepted.
4. **Cancel on Stripe.** Place an order, and on the Stripe page press the back arrow (top left). You land on "Payment cancelled". In the admin, nothing new appears. (In Cloudflare: Workers & Pages -> D1 -> ofst-orders -> `pending_checkouts` should not contain it.)
5. **Pay.** Place an order and pay with the test card `4242 4242 4242 4242` (any future date, any CVC). The order page should change to "paid" within a few seconds, you get the confirmation email, and the order appears in the admin, with the NIF if you entered one.
6. **Phone.** Repeat test 1 and 5 on your phone. On a phone, open the sign-in email in the same browser you were shopping in (for example: long-press the link, "Open in Safari"). If the link opens in a different app or browser, you are still signed in there, but the kit you tried to add is not carried over (just add it again).

## Good to know

- Customers who were already signed in on the old site stay signed in.
- Slow payment methods (Multibanco) keep their draft for up to 30 days, until Stripe tells us the money arrived (then it becomes an order) or that it failed.
- Drafts nobody paid are also deleted automatically after 24 hours, as a safety net.
- Nothing changes in the Stripe Dashboard: the webhook events you already selected (`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`) are all that is needed.
