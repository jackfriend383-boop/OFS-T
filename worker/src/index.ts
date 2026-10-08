import { priceItem, isPersonalised, type PricedItem } from './pricing';
import { createCheckoutSession, expireCheckoutSession, verifyWebhook } from './stripe';
import { sendMail, signInEmail, paidEmail, invoiceEmail, type MailAttachment } from './mail';

/* OFS/T order API (Cloudflare Worker + D1). The only code that touches the database.
   Public:  POST   /api/checkout               (signed-in customers only) validate + price an order on the server, keep it as a
                                               draft in pending_checkouts and return a Stripe Checkout URL
            POST   /api/checkout/:id/cancel    the customer came back from Stripe without paying: close the session, drop the draft
            GET    /api/orders/:id/status      payment status of one order (by its unguessable id)
            POST   /api/stripe/webhook         Stripe -> us (signature verified); the only thing that creates a paid order
   An order only exists in the `orders` table once Stripe says it was paid; until then it is a draft in `pending_checkouts`.
   Account: POST   /api/auth/request           {email,lang} -> emails a one-time sign-in link (always answers ok: no account enumeration)
            POST   /api/auth/verify            {token} -> {access_token,expires_in,user}   (link tokens are single-use, 15 minutes)
            POST   /api/auth/logout            ends this customer session
            GET    /api/me   PATCH /api/me     profile (name, phone, delivery address)
            GET    /api/me/orders              this customer's paid orders       DELETE /api/me   delete the account
   Admin:   POST   /api/admin/login            {email,password} -> {access_token,expires_in,user}
            POST   /api/admin/logout           revokes every admin session
            GET    /api/admin/orders           newest 500 orders
            PATCH  /api/admin/orders/:id       {status}
            POST   /api/admin/resend-paid-emails  send the payment confirmation again to paid orders (max 40 per call)
   Trust boundaries: every byte of a request is untrusted (the site's JS can be modified by anyone). Orders are checked
   against the same limits as worker/schema.sql. Admin identity is a random bearer token issued after a correct password;
   only its SHA-256 hash is stored. Prices are computed here (pricing.ts), never taken from the browser. */

export interface Env {
  DB: D1Database;
  ofst_orders?: D1Database;
  ALLOWED_ORIGINS: string;
  SITE_URL: string;               // public site origin used for Stripe's return links, e.g. https://ofstdesigns.com
  STRIPE_SECRET_KEY: string;      // secret: wrangler secret put STRIPE_SECRET_KEY  (sk_test_... then sk_live_...)
  STRIPE_WEBHOOK_SECRET: string;  // secret: wrangler secret put STRIPE_WEBHOOK_SECRET  (whsec_...)
  RESEND_API_KEY: string;         // secret: wrangler secret put RESEND_API_KEY  (sign-in links + order emails)
  MAIL_FROM: string;              // var, e.g. "OFS/T <no-reply@ofstdesigns.com>" (domain verified in Resend)
  ADMIN_EMAIL: string;      // secret: wrangler secret put ADMIN_EMAIL
  ADMIN_PASSWORD: string;   // secret: wrangler secret put ADMIN_PASSWORD  (12+ characters)
}

const MAX_ORDERS_PER_10_MIN = 30;     // global flood cap on checkouts started (same as the old schema); raise if you ever get more real orders
const MAX_FAILED_LOGINS_PER_15_MIN = 10;
const SESSION_SECONDS = 8 * 3600;
const CUSTOMER_SESSION_SECONDS = 30 * 86400;
const MAX_LINKS_PER_EMAIL_15_MIN = 3;
const MAX_LINKS_GLOBAL_15_MIN = 100;
const PROFILE_LIMITS: Record<string, number> = { name: 200, phone: 40, street: 300, postcode: 20, city: 120, country: 60 };
const MAX_BODY = 40000;
const MAX_INVOICE_BYTES = 750000;
const INVOICE_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const STATUSES = ['new', 'printed', 'shipped'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CUSTOMER_LIMITS: Record<string, [number, number]> = {
  name: [1, 200], email: [3, 254], street: [1, 300], postcode: [1, 20], city: [1, 120], country: [1, 60],
};
const OPTIONAL_CUSTOMER = ['nif']; // optional extra fields (validated separately below)

/* Portuguese tax number (NIF): 9 digits, the last one is a mod-11 check digit. Same rule as the checkout form (backend.ts). */
function validNif(v: string): boolean {
  if (!/^\d{9}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(v[i]) * (9 - i);
  const r = sum % 11;
  return Number(v[8]) === (r < 2 ? 0 : 11 - r);
}

class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

/* ---------- helpers ---------- */
const enc = new TextEncoder();

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', enc.encode(s));
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
/* Constant-time string comparison (hash both so the lengths always match). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  return (crypto.subtle as any).timingSafeEqual(x, y);
}
function newToken(): string {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function allowedOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get('Origin');
  if (!origin) return null;
  const list = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

function respond(data: unknown, status: number, req: Request, env: Env, extra: Record<string, string> = {}): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  };
  const origin = allowedOrigin(req, env);
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return new Response(data === null ? null : JSON.stringify(data), { status, headers });
}

async function readJson(req: Request, max = MAX_BODY): Promise<any> {
  if (!/^application\/json\b/i.test(req.headers.get('Content-Type') || '')) throw new HttpError(415, 'unsupported_media_type');
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > max) throw new HttpError(413, 'too_large');
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, 'too_large');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'invalid'); }
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/* ---------- order validation (mirrors the CHECK constraints in schema.sql) ---------- */
function validateOrder(b: any) {
  if (!isObj(b)) throw new HttpError(400, 'invalid');
  const c = b.customer;
  if (!isObj(c)) throw new HttpError(400, 'invalid');
  const customer: Record<string, string> = {};
  for (const k of Object.keys(c)) if (!(k in CUSTOMER_LIMITS) && !OPTIONAL_CUSTOMER.includes(k)) throw new HttpError(400, 'invalid'); // no extra personal data
  for (const [k, [min, max]] of Object.entries(CUSTOMER_LIMITS)) {
    const v = c[k];
    if (typeof v !== 'string' || v.length < min || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) throw new HttpError(400, 'invalid');
    customer[k] = v;
  }
  if (!EMAIL.test(customer.email)) throw new HttpError(400, 'invalid');
  // NIF is optional; when given it must be a valid Portuguese tax number (spaces are allowed and removed).
  if (c.nif !== undefined && c.nif !== null && c.nif !== '') {
    const nif = typeof c.nif === 'string' ? c.nif.replace(/\s+/g, '') : '';
    if (!validNif(nif)) throw new HttpError(400, 'invalid_nif');
    customer.nif = nif;
  }

  // Every line is re-validated and priced here from the shared price list; any total the browser sends is ignored.
  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 50) throw new HttpError(400, 'invalid');
  const priced = b.items.map(priceItem);
  if (priced.some((i: PricedItem | null) => !i)) throw new HttpError(400, 'invalid');
  const lines = priced as PricedItem[];
  const itemsJson = JSON.stringify(lines);
  if (itemsJson.length > 30000) throw new HttpError(400, 'invalid');
  const total = lines.reduce((s, i) => s + i.unit_cents * i.qty, 0);
  if (!Number.isInteger(total) || total < 1 || total > 1000000) throw new HttpError(400, 'invalid');

  if (b.consent_terms !== true) throw new HttpError(400, 'invalid');
  // Personalised kits need the buyer's explicit acknowledgement (no change-of-mind returns).
  if (lines.some(isPersonalised) && b.consent_personalised !== true) throw new HttpError(400, 'invalid');
  const lang: 'pt' | 'en' = b.lang === 'en' ? 'en' : 'pt';
  const id = crypto.randomUUID();

  return { id, customer: JSON.stringify(customer), email: customer.email, items: itemsJson, lines, total, lang, personalised: b.consent_personalised === true ? 1 : null };
}

/* ---------- handlers ---------- */
/* Checkout drafts the customer never paid for are removed after this long. A Stripe session expires after 31 minutes and Stripe
   normally tells us at once (checkout.session.expired), so this is only a safety net. It is kept generous because Stripe retries a
   failed webhook for up to 3 days: if the paid notice is late (e.g. the Worker was down), the draft must still be there.
   Drafts waiting for a slow payment method (Multibanco) are kept for 30 days. */
const STALE_DRAFT = '-24 hours';
const STALE_AWAITING = '-30 days';

/* Step 1 of paying: keep the order as a draft in pending_checkouts, open a Stripe Checkout Session for exactly that amount and
   hand back its URL. Nothing is written to `orders` until Stripe's signed webhook says it was paid (see stripeWebhook). */
async function startCheckout(req: Request, env: Env) {
  if (!env.STRIPE_SECRET_KEY || !env.SITE_URL) throw new HttpError(503, 'not_configured');
  const uid = await customerId(req, env);
  if (!uid) throw new HttpError(401, 'sign_in_required'); // only signed-in customers can buy
  const o = validateOrder(await readJson(req));
  // Opportunistic clean-up of abandoned drafts, then the global flood cap.
  await env.DB.prepare(
    `DELETE FROM pending_checkouts WHERE (awaiting_payment = 0 AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?1))
       OR created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?2)`,
  ).bind(STALE_DRAFT, STALE_AWAITING).run();
  const { n } = (await env.DB.prepare(
    "SELECT count(*) AS n FROM pending_checkouts WHERE created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')",
  ).first<{ n: number }>())!;
  if (n >= MAX_ORDERS_PER_10_MIN) throw new HttpError(429, 'rate_limited');
  await env.DB.prepare(
    'INSERT INTO pending_checkouts (id, customer, items, total_cents, lang, consent_personalised, user_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
  ).bind(o.id, o.customer, o.items, o.total, o.lang, o.personalised, uid).run();

  const site = env.SITE_URL.trim().replace(/\/$/, '');
  const root = o.lang === 'en' ? `${site}/en` : site;
  let session: { id: string; url: string };
  try {
    session = await createCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY, orderId: o.id, email: o.email, items: o.lines, locale: o.lang,
      successUrl: `${root}/order/?o=${o.id}`, cancelUrl: `${root}/order/?o=${o.id}&cancelled=1`,
    });
  } catch {
    await env.DB.prepare('DELETE FROM pending_checkouts WHERE id = ?1').bind(o.id).run();
    throw new HttpError(502, 'payment_unavailable');
  }
  await env.DB.prepare('UPDATE pending_checkouts SET stripe_session_id = ?1 WHERE id = ?2').bind(session.id, o.id).run();
  return { id: o.id, url: session.url };
}

/* The customer pressed "back" on Stripe's page (Stripe sends them to /order/?o=..&cancelled=1). Close the Stripe session so it
   can't be paid later, then drop the draft. The draft is only dropped once Stripe confirms the session is expired, so an order
   can never be lost if the customer actually paid in another tab. Answers ok either way (nothing to reveal). */
async function cancelCheckout(env: Env, id: string) {
  if (!UUID.test(id)) throw new HttpError(400, 'invalid');
  const row = await env.DB.prepare('SELECT stripe_session_id FROM pending_checkouts WHERE id = ?1 AND awaiting_payment = 0')
    .bind(id.toLowerCase()).first<{ stripe_session_id: string | null }>();
  if (!row) return { ok: true };
  const status = row.stripe_session_id && env.STRIPE_SECRET_KEY ? await expireCheckoutSession(env.STRIPE_SECRET_KEY, row.stripe_session_id) : null;
  if (status === 'expired' || !row.stripe_session_id) {
    await env.DB.prepare('DELETE FROM pending_checkouts WHERE id = ?1 AND awaiting_payment = 0').bind(id.toLowerCase()).run();
  }
  return { ok: true };
}

/* Public, read-only: lets the "thank you" page ask whether an order (by its unguessable id) has been paid.
   A draft that is still waiting for Stripe answers 'unpaid'. */
async function orderStatus(env: Env, id: string) {
  if (!UUID.test(id)) throw new HttpError(400, 'invalid');
  const key = id.toLowerCase();
  const row = await env.DB.prepare('SELECT payment_status FROM orders WHERE id = ?1').bind(key).first<{ payment_status: string }>();
  if (row) return { id: key, payment_status: row.payment_status };
  const draft = await env.DB.prepare('SELECT 1 AS ok FROM pending_checkouts WHERE id = ?1').bind(key).first();
  if (draft) return { id: key, payment_status: 'unpaid' };
  throw new HttpError(404, 'not_found');
}

/* Payment confirmation email. Best effort: a mail problem must never make the webhook fail (the order is already paid). */
async function notifyPaid(env: Env, orderId: string): Promise<string | null> {
  try {
    const o = await env.DB.prepare('SELECT customer, items, total_cents, lang FROM orders WHERE id = ?1').bind(orderId).first<any>();
    if (!o) return 'not_found';
    const email = JSON.parse(o.customer).email as string;
    const m = paidEmail(o.lang === 'en' ? 'en' : 'pt', orderId.slice(-6).toUpperCase(), o.total_cents, JSON.parse(o.items));
    await sendMail(env, email, m.subject, m.html, m.text);
    return null; // sent
  } catch (e: any) { console.error('paid email not sent', e && e.message); return String((e && e.message) || 'mail_failed'); }
}

/* Admin: send the payment confirmation email again to every paid order (newest first). At most RESEND_BATCH per click,
   because a free Cloudflare Worker may make about 50 outgoing requests per run; `remaining` tells the admin to click again.
   Spaced out to stay under Resend's rate limit. Returns counts and the first error reason (e.g. mail_not_configured). */
const RESEND_BATCH = 40;
async function resendPaidEmails(env: Env) {
  const { results } = await env.DB.prepare("SELECT id FROM orders WHERE payment_status = 'paid' ORDER BY created_at DESC").all<{ id: string }>();
  const batch = results.slice(0, RESEND_BATCH);
  let sent = 0, failed = 0, reason: string | null = null;
  for (const [i, r] of batch.entries()) {
    if (i) await new Promise((ok) => setTimeout(ok, 600));
    const err = await notifyPaid(env, r.id);
    if (err) { failed++; reason = reason || err; if (err === 'mail_not_configured') break; } else sent++;
  }
  return { total: results.length, sent, failed, remaining: Math.max(0, results.length - batch.length), reason };
}

/* Stripe -> us. The signature is checked before anything in the body is trusted; the amount must match our own total.
   Paid: the draft is copied into `orders` (once: Stripe retries are ignored) and deleted. Expired / failed: the draft is deleted.
   Orders created by the previous version of this Worker (stored in `orders` as 'unpaid') are still updated in place. */
async function stripeWebhook(req: Request, env: Env) {
  const body = await req.text();
  if (body.length > 200000 || !(await verifyWebhook(body, req.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET))) throw new HttpError(400, 'invalid');
  let ev: any;
  try { ev = JSON.parse(body); } catch { throw new HttpError(400, 'invalid'); }
  const s = ev && ev.data && ev.data.object;
  if (!s || typeof s.id !== 'string') return { received: true };
  const orderId = String(s.client_reference_id || (s.metadata && s.metadata.order_id) || '').toLowerCase();
  if (!UUID.test(orderId)) return { received: true };

  const draft = await env.DB.prepare('SELECT total_cents FROM pending_checkouts WHERE id = ?1 AND stripe_session_id = ?2')
    .bind(orderId, s.id).first<{ total_cents: number }>();
  if (draft) {
    const dropDraft = () => env.DB.prepare('DELETE FROM pending_checkouts WHERE id = ?1').bind(orderId).run();
    switch (ev.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        if (s.payment_status === 'paid') {
          const ok = s.amount_total === draft.total_cents && String(s.currency).toLowerCase() === 'eur';
          // Copy the draft into orders and delete it in one transaction. INSERT OR IGNORE: a retried event changes nothing.
          const [ins] = await env.DB.batch([
            env.DB.prepare(
              `INSERT OR IGNORE INTO orders (id, customer, items, total_cents, lang, consent_terms, consent_personalised, payment_status, stripe_session_id, paid_at, user_id)
               SELECT id, customer, items, total_cents, lang, 1, consent_personalised, ?2, stripe_session_id, ${ok ? NOW : 'NULL'}, user_id
               FROM pending_checkouts WHERE id = ?1`,
            ).bind(orderId, ok ? 'paid' : 'mismatch'),
            // Only drop the draft once the order really is in `orders` (never lose a paid order if the insert was skipped).
            env.DB.prepare('DELETE FROM pending_checkouts WHERE id = ?1 AND EXISTS (SELECT 1 FROM orders WHERE id = ?1)').bind(orderId),
          ]);
          if (ok && ins.meta.changes === 1) await notifyPaid(env, orderId); // first time only
        } else if (ev.type === 'checkout.session.completed') {
          // Slow payment method (e.g. Multibanco): the customer finished on Stripe but the money arrives later. Keep the draft.
          await env.DB.prepare('UPDATE pending_checkouts SET awaiting_payment = 1 WHERE id = ?1').bind(orderId).run();
        }
        break;
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        await dropDraft();
        break;
    }
    return { received: true };
  }

  // Older orders (created before drafts existed) or a retried event for an order that is already in `orders`.
  const order = await env.DB.prepare('SELECT total_cents, payment_status FROM orders WHERE id = ?1 AND stripe_session_id = ?2')
    .bind(orderId, s.id).first<{ total_cents: number; payment_status: string }>();
  if (!order) return { received: true };

  const set = (status: string, paid = false) => env.DB.prepare(
    `UPDATE orders SET payment_status = ?1${paid ? ", paid_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')" : ''} WHERE id = ?2 AND payment_status != 'paid'`,
  ).bind(status, orderId).run();

  switch (ev.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      if (s.payment_status === 'paid') {
        const ok = s.amount_total === order.total_cents && String(s.currency).toLowerCase() === 'eur';
        const r = await set(ok ? 'paid' : 'mismatch', ok);
        if (ok && r.meta.changes === 1) await notifyPaid(env, orderId); // first time only: Stripe retries do not re-send
      }
      break;
    case 'checkout.session.async_payment_failed': await set('failed'); break;
    case 'checkout.session.expired': await set('expired'); break;
  }
  return { received: true };
}

async function login(req: Request, env: Env) {
  const b = await readJson(req);
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 12) throw new HttpError(503, 'not_configured');
  const email = isObj(b) && typeof b.email === 'string' ? b.email.trim().toLowerCase().slice(0, 254) : '';
  const password = isObj(b) && typeof b.password === 'string' ? b.password.slice(0, 500) : '';

  await env.DB.prepare("DELETE FROM login_attempts WHERE at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')").run();
  const { n } = (await env.DB.prepare(
    "SELECT count(*) AS n FROM login_attempts WHERE at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-15 minutes')",
  ).first<{ n: number }>())!;
  if (n >= MAX_FAILED_LOGINS_PER_15_MIN) throw new HttpError(429, 'rate_limited');

  // Evaluate both comparisons before branching so the timing does not reveal which one failed.
  const [okEmail, okPass] = await Promise.all([safeEqual(email, env.ADMIN_EMAIL.trim().toLowerCase()), safeEqual(password, env.ADMIN_PASSWORD)]);
  if (!okEmail || !okPass) {
    await env.DB.prepare('INSERT INTO login_attempts DEFAULT VALUES').run();
    throw new HttpError(401, 'invalid_credentials');
  }
  const token = newToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"),
    env.DB.prepare("INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?2))")
      .bind(hex(await sha256(token)), `+${SESSION_SECONDS} seconds`),
  ]);
  return { access_token: token, expires_in: SESSION_SECONDS, user: { email: env.ADMIN_EMAIL.trim() } };
}

async function requireAdmin(req: Request, env: Env) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.get('Authorization') || '');
  if (!m) throw new HttpError(401, 'session_expired');
  const row = await env.DB.prepare(
    "SELECT 1 AS ok FROM admin_sessions WHERE token_hash = ?1 AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
  ).bind(hex(await sha256(m[1]))).first();
  if (!row) throw new HttpError(401, 'session_expired');
}

async function listOrders(env: Env) {
  const { results } = await env.DB.prepare(
    "SELECT id, created_at, status, customer, items, total_cents, consent_terms, consent_personalised, payment_status, paid_at FROM orders WHERE payment_status IN ('paid', 'mismatch') ORDER BY created_at DESC LIMIT 500",
  ).all<any>();
  return results.map((r) => ({
    ...r,
    customer: JSON.parse(r.customer),
    items: JSON.parse(r.items),
    consent_terms: r.consent_terms === 1,
    consent_personalised: r.consent_personalised === 1 ? true : null,
  }));
}

async function listInvoices(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.created_at, o.status, o.customer, o.items, o.total_cents, o.payment_status
    FROM orders o
    WHERE o.payment_status IN ('paid', 'mismatch') AND o.invoice_sent_at IS NULL
    ORDER BY o.created_at ASC LIMIT 500`,
  ).all<any>();
  return results.map((r) => ({ ...r, customer: JSON.parse(r.customer), items: JSON.parse(r.items) }));
}

function safeFilename(value: unknown) {
  const name = String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return name || 'invoice.pdf';
}

async function addInvoice(req: Request, env: Env, id: string) {
  if (!UUID.test(id)) throw new HttpError(400, 'invalid');
  const b = await readJson(req, MAX_INVOICE_BYTES * 2);
  if (!isObj(b) || typeof b.filename !== 'string' || typeof b.content_type !== 'string' || typeof b.data !== 'string') throw new HttpError(400, 'invalid');
  const contentType = b.content_type.toLowerCase();
  if (!INVOICE_TYPES.includes(contentType) || !/^[A-Za-z0-9+/]*={0,2}$/.test(b.data) || b.data.length < 1 || b.data.length > 1100000) throw new HttpError(400, 'invalid');
  const bytes = Math.floor(b.data.length * 3 / 4) - (b.data.endsWith('==') ? 2 : b.data.endsWith('=') ? 1 : 0);
  if (bytes < 1 || bytes > MAX_INVOICE_BYTES) throw new HttpError(413, 'too_large');
  const order = await env.DB.prepare(`SELECT id, customer, items, total_cents, lang FROM orders WHERE id = ?1 AND payment_status IN ('paid', 'mismatch')`).bind(id.toLowerCase()).first<any>();
  if (!order) throw new HttpError(404, 'not_found');
  const filename = safeFilename(b.filename);
  const customer = JSON.parse(order.customer);
  const lines = JSON.parse(order.items).map((i: any) => ({ name: String(i.name || 'OFS/T kit').slice(0, 200), desc: String(i.desc || '').slice(0, 300), qty: Math.max(1, Math.min(99, Math.floor(+i.qty) || 1)) }));
  const m = invoiceEmail(order.lang === 'en' ? 'en' : 'pt', order.id.slice(-6).toUpperCase(), order.total_cents, lines);
  const attachment: MailAttachment = { filename, content: b.data, content_type: contentType };
  try {
    await sendMail(env, customer.email, m.subject, m.html, m.text, [attachment]);
    const marked = await env.DB.prepare(`UPDATE orders SET invoice_sent_at = ${NOW} WHERE id = ?1 AND invoice_sent_at IS NULL RETURNING id`).bind(order.id).first();
    if (!marked) throw new Error('invoice_already_sent');
  } catch {
    throw new HttpError(502, 'mail_unavailable');
  }
  return { order_id: order.id, filename, email_sent: true };
}

async function setStatus(req: Request, env: Env, id: string) {
  const b = await readJson(req);
  if (!UUID.test(id) || !isObj(b) || !STATUSES.includes(b.status)) throw new HttpError(400, 'invalid');
  const row = await env.DB.prepare('UPDATE orders SET status = ?1 WHERE id = ?2 RETURNING id, status').bind(b.status, id.toLowerCase()).first();
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}

/* ---------- customer accounts (passwordless) ---------- */
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const bearer = (req: Request) => /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.get('Authorization') || '')?.[1] ?? null;

/* The signed-in customer's id for this request, or null (guests, expired or unknown tokens). */
async function customerId(req: Request, env: Env): Promise<string | null> {
  const t = bearer(req); if (!t) return null;
  const row = await env.DB.prepare(`SELECT user_id FROM customer_sessions WHERE token_hash = ?1 AND expires_at > ${NOW}`)
    .bind(hex(await sha256(t))).first<{ user_id: string }>();
  return row ? row.user_id : null;
}
async function requireCustomer(req: Request, env: Env): Promise<string> {
  const id = await customerId(req, env);
  if (!id) throw new HttpError(401, 'session_expired');
  return id;
}
const publicUser = (u: any) => ({ id: u.id, email: u.email, name: u.name, phone: u.phone, street: u.street, postcode: u.postcode, city: u.city, country: u.country, lang: u.lang });

function validBirthDate(value: unknown): string {
  const birthDate = typeof value === 'string' ? value : '';
  if (!DATE.test(birthDate)) throw new HttpError(400, 'invalid');
  const date = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== birthDate || date > new Date()) throw new HttpError(400, 'invalid');
  const now = new Date();
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const birthdayPassed = now.getUTCMonth() > date.getUTCMonth() || (now.getUTCMonth() === date.getUTCMonth() && now.getUTCDate() >= date.getUTCDate());
  if (!birthdayPassed) age--;
  if (age < 13) throw new HttpError(403, 'age_restricted');
  return birthDate;
}

/* Emails a one-time sign-in link. Whether or not the address has an account, and whether or not it was throttled, the answer is
   the same {ok:true}, so this cannot be used to discover who has an account. The token travels in the URL #fragment (never sent
   to any server, and not consumed by mail scanners that merely fetch the link); only its hash is stored. */
async function requestLink(req: Request, env: Env) {
  const b = await readJson(req);
  const email = isObj(b) && typeof b.email === 'string' ? b.email.trim().toLowerCase().slice(0, 254) : '';
  if (!EMAIL.test(email) || /[\u0000-\u001f\u007f<>"]/.test(email)) throw new HttpError(400, 'invalid');
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first<{ id: string }>();
  const rawBirthDate = isObj(b) && typeof b.birth_date === 'string' ? b.birth_date : '';
  if (!existing && !rawBirthDate) return { ok: true, needs_birth_date: true };
  const birthDate = existing ? (rawBirthDate ? validBirthDate(rawBirthDate) : null) : validBirthDate(rawBirthDate);
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !env.SITE_URL) throw new HttpError(503, 'not_configured');
  const lang: 'pt' | 'en' = isObj(b) && b.lang === 'en' ? 'en' : 'pt';

  await env.DB.prepare(`DELETE FROM link_requests WHERE at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')`).run();
  const [per, all] = await Promise.all([
    env.DB.prepare(`SELECT count(*) AS n FROM link_requests WHERE email = ?1 AND at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-15 minutes')`).bind(email).first<{ n: number }>(),
    env.DB.prepare(`SELECT count(*) AS n FROM link_requests WHERE at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-15 minutes')`).first<{ n: number }>(),
  ]);
  if (all!.n >= MAX_LINKS_GLOBAL_15_MIN) throw new HttpError(429, 'rate_limited');
  if (per!.n >= MAX_LINKS_PER_EMAIL_15_MIN) return { ok: true };

  const token = newToken();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO link_requests (email) VALUES (?1)').bind(email),
    env.DB.prepare(`DELETE FROM login_links WHERE expires_at < ${NOW}`),
    env.DB.prepare(`INSERT INTO login_links (token_hash, email, birth_date, expires_at) VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+15 minutes'))`)
      .bind(hex(await sha256(token)), email, birthDate),
  ]);
  const site = env.SITE_URL.trim().replace(/\/$/, '');
  const m = signInEmail(lang, `${site}${lang === 'en' ? '/en' : ''}/account/#token=${token}`);
  try { await sendMail(env, email, m.subject, m.html, m.text); }
  catch { throw new HttpError(502, 'mail_unavailable'); }
  return { ok: true };
}

/* Exchanges a valid, unused, unexpired link token for a customer session (creating the account on first use). */
async function verifyLink(req: Request, env: Env) {
  const b = await readJson(req);
  const token = isObj(b) && typeof b.token === 'string' ? b.token : '';
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new HttpError(401, 'invalid_link');
  const link = await env.DB.prepare(
    `UPDATE login_links SET used_at = ${NOW} WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ${NOW} RETURNING email, birth_date`,
  ).bind(hex(await sha256(token))).first<{ email: string; birth_date: string }>();
  if (!link) throw new HttpError(401, 'invalid_link');

  const lang = isObj(b) && b.lang === 'en' ? 'en' : 'pt';
  const user = await env.DB.prepare(
     `INSERT INTO users (id, email, birth_date, last_login_at, lang) VALUES (?1, ?2, ?3, ${NOW}, ?4)
      ON CONFLICT(email) DO UPDATE SET last_login_at = excluded.last_login_at, birth_date = COALESCE(users.birth_date, excluded.birth_date) RETURNING *`,
    ).bind(crypto.randomUUID(), link.email, link.birth_date, lang).first<any>();

  const session = newToken();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM customer_sessions WHERE expires_at < ${NOW}`),
    env.DB.prepare(`INSERT INTO customer_sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?3))`)
      .bind(hex(await sha256(session)), user.id, `+${CUSTOMER_SESSION_SECONDS} seconds`),
  ]);
  return { access_token: session, expires_in: CUSTOMER_SESSION_SECONDS, user: publicUser(user) };
}

async function customerLogout(req: Request, env: Env) {
  const t = bearer(req);
  if (t) await env.DB.prepare('DELETE FROM customer_sessions WHERE token_hash = ?1').bind(hex(await sha256(t))).run();
  return { ok: true };
}

async function getMe(env: Env, uid: string) {
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(uid).first<any>();
  if (!u) throw new HttpError(401, 'session_expired');
  return publicUser(u);
}

/* Only the listed profile fields can change (the email is the identity and never changes here). */
async function updateMe(req: Request, env: Env, uid: string) {
  const b = await readJson(req);
  if (!isObj(b)) throw new HttpError(400, 'invalid');
  const sets: string[] = [], vals: (string | null)[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (!(k in PROFILE_LIMITS)) throw new HttpError(400, 'invalid');
    if (v !== null && (typeof v !== 'string' || v.length > PROFILE_LIMITS[k] || /[\u0000-\u001f\u007f]/.test(v))) throw new HttpError(400, 'invalid');
    sets.push(`${k} = ?${sets.length + 1}`);
    vals.push(typeof v === 'string' && v.trim() ? v.trim() : null);
  }
  if (!sets.length) throw new HttpError(400, 'invalid');
  const u = await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?${sets.length + 1} RETURNING *`).bind(...vals, uid).first<any>();
  if (!u) throw new HttpError(401, 'session_expired');
  return publicUser(u);
}

/* Paid orders placed while signed in, plus guest orders made with the same (now verified) email address. */
async function myOrders(env: Env, uid: string) {
  const u = await env.DB.prepare('SELECT email FROM users WHERE id = ?1').bind(uid).first<{ email: string }>();
  if (!u) throw new HttpError(401, 'session_expired');
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, status, items, total_cents, payment_status, paid_at FROM orders
     WHERE payment_status = 'paid' AND (user_id = ?1 OR lower(json_extract(customer, '$.email')) = ?2)
     ORDER BY created_at DESC LIMIT 100`,
  ).bind(uid, u.email).all<any>();
  return results.map((r) => ({ ...r, items: JSON.parse(r.items) }));
}

/* Deletes the account and its sessions. Orders are kept (accounting law) but no longer point at the account. */
async function deleteMe(env: Env, uid: string) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM customer_sessions WHERE user_id = ?1').bind(uid),
    env.DB.prepare('UPDATE orders SET user_id = NULL WHERE user_id = ?1').bind(uid),
    env.DB.prepare('UPDATE pending_checkouts SET user_id = NULL WHERE user_id = ?1').bind(uid),
    env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(uid),
  ]);
  return { ok: true };
}

/* ---------- router ---------- */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (!env.DB && env.ofst_orders) env.DB = env.ofst_orders;
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');
    try {
      if (req.method === 'OPTIONS') {
        if (!allowedOrigin(req, env)) return respond(null, 403, req, env);
        return respond(null, 204, req, env, {
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400',
        });
      }
      if (path === '' || path === '/api/health') return respond({ ok: true }, 200, req, env);

      // Stripe's servers send no Origin header; the signature is the authentication.
      if (path === '/api/stripe/webhook' && req.method === 'POST') return respond(await stripeWebhook(req, env), 200, req, env);

      // Browsers always send Origin on cross-site requests; refuse any that is not one of our sites.
      if (req.headers.get('Origin') && !allowedOrigin(req, env)) throw new HttpError(403, 'denied');

      if (path === '/api/auth/request' && req.method === 'POST') return respond(await requestLink(req, env), 200, req, env);
      if (path === '/api/auth/verify' && req.method === 'POST') return respond(await verifyLink(req, env), 200, req, env);
      if (path === '/api/auth/logout' && req.method === 'POST') return respond(await customerLogout(req, env), 200, req, env);
      if (path === '/api/me' || path.startsWith('/api/me/')) {
        const uid = await requireCustomer(req, env);
        if (path === '/api/me' && req.method === 'GET') return respond(await getMe(env, uid), 200, req, env);
        if (path === '/api/me' && req.method === 'PATCH') return respond(await updateMe(req, env, uid), 200, req, env);
        if (path === '/api/me' && req.method === 'DELETE') return respond(await deleteMe(env, uid), 200, req, env);
        if (path === '/api/me/orders' && req.method === 'GET') return respond(await myOrders(env, uid), 200, req, env);
        throw new HttpError(404, 'not_found');
      }
      if (path === '/api/checkout' && req.method === 'POST') return respond(await startCheckout(req, env), 201, req, env);
      const cancel = /^\/api\/checkout\/([^/]+)\/cancel$/.exec(path);
      if (cancel && req.method === 'POST') return respond(await cancelCheckout(env, cancel[1]), 200, req, env);
      const st = /^\/api\/orders\/([^/]+)\/status$/.exec(path);
      if (st && req.method === 'GET') return respond(await orderStatus(env, st[1]), 200, req, env);
      if (path === '/api/admin/login' && req.method === 'POST') return respond(await login(req, env), 200, req, env);

      if (path.startsWith('/api/admin/')) {
        await requireAdmin(req, env);
        if (path === '/api/admin/logout' && req.method === 'POST') {
          await env.DB.prepare('DELETE FROM admin_sessions').run();
          return respond({ ok: true }, 200, req, env);
        }
        if (path === '/api/admin/orders' && req.method === 'GET') return respond(await listOrders(env), 200, req, env);
        if (path === '/api/admin/resend-paid-emails' && req.method === 'POST') return respond(await resendPaidEmails(env), 200, req, env);
        if (path === '/api/admin/invoices' && req.method === 'GET') return respond(await listInvoices(env), 200, req, env);
        const m = /^\/api\/admin\/orders\/([^/]+)$/.exec(path);
        if (m && req.method === 'PATCH') return respond(await setStatus(req, env, m[1]), 200, req, env);
        const invoice = /^\/api\/admin\/orders\/([^/]+)\/invoice$/.exec(path);
        if (invoice && req.method === 'POST') return respond(await addInvoice(req, env, invoice[1]), 201, req, env);
      }
      throw new HttpError(404, 'not_found');
    } catch (e: any) {
      if (e instanceof HttpError) return respond({ error: e.code }, e.status, req, env);
      console.error('unhandled', e && e.message);
      return respond({ error: 'server' }, 500, req, env);
    }
  },
} satisfies ExportedHandler<Env>;
