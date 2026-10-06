/* OFS/T order API (Cloudflare Worker + D1). The only code that touches the database.
   Public:  POST   /api/orders                 add an order (validated, flood-capped)
   Admin:   POST   /api/admin/login            {email,password} -> {access_token,expires_in,user}
            POST   /api/admin/logout           revokes every admin session
            GET    /api/admin/orders           newest 500 orders
            PATCH  /api/admin/orders/:id       {status}
   Trust boundaries: every byte of a request is untrusted (the site's JS can be modified by anyone). Orders are checked
   against the same limits as worker/schema.sql. Admin identity is a random bearer token issued after a correct password;
   only its SHA-256 hash is stored. total_cents comes from the browser, so the owner must still check it against the
   price list before asking for payment (the admin page warns on a mismatch). */

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  ADMIN_EMAIL: string;      // secret: wrangler secret put ADMIN_EMAIL
  ADMIN_PASSWORD: string;   // secret: wrangler secret put ADMIN_PASSWORD  (12+ characters)
}

const MAX_ORDERS_PER_10_MIN = 30;     // global flood cap (same as the old schema); raise if you ever get more real orders
const MAX_FAILED_LOGINS_PER_15_MIN = 10;
const SESSION_SECONDS = 8 * 3600;
const MAX_BODY = 40000;
const STATUSES = ['new', 'printed', 'shipped'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CUSTOMER_LIMITS: Record<string, [number, number]> = {
  name: [1, 200], email: [3, 254], street: [1, 300], postcode: [1, 20], city: [1, 120], country: [1, 60],
};

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

async function readJson(req: Request): Promise<any> {
  if (!/^application\/json\b/i.test(req.headers.get('Content-Type') || '')) throw new HttpError(415, 'unsupported_media_type');
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) throw new HttpError(413, 'too_large');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'too_large');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'invalid'); }
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/* ---------- order validation (mirrors the CHECK constraints in schema.sql) ---------- */
function validateOrder(b: any) {
  if (!isObj(b)) throw new HttpError(400, 'invalid');
  const c = b.customer;
  if (!isObj(c)) throw new HttpError(400, 'invalid');
  const customer: Record<string, string> = {};
  for (const k of Object.keys(c)) if (!(k in CUSTOMER_LIMITS)) throw new HttpError(400, 'invalid'); // no extra personal data
  for (const [k, [min, max]] of Object.entries(CUSTOMER_LIMITS)) {
    const v = c[k];
    if (typeof v !== 'string' || v.length < min || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) throw new HttpError(400, 'invalid');
    customer[k] = v;
  }
  if (!EMAIL.test(customer.email)) throw new HttpError(400, 'invalid');

  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 50) throw new HttpError(400, 'invalid');
  const items = JSON.stringify(b.items);
  if (items.length > 30000) throw new HttpError(400, 'invalid');

  const total = b.total_cents;
  if (!Number.isInteger(total) || total < 1 || total > 1000000) throw new HttpError(400, 'invalid');
  if (b.consent_terms !== true) throw new HttpError(400, 'invalid');
  if (b.consent_personalised !== null && b.consent_personalised !== true && b.consent_personalised !== undefined) throw new HttpError(400, 'invalid');
  const lang = b.lang == null ? null : String(b.lang);
  if (lang !== null && !/^[a-z]{2}(-[A-Za-z]{2})?$/.test(lang)) throw new HttpError(400, 'invalid');
  const id = b.id === undefined ? crypto.randomUUID() : String(b.id);
  if (!UUID.test(id)) throw new HttpError(400, 'invalid');

  return { id: id.toLowerCase(), customer: JSON.stringify(customer), items, total, lang, personalised: b.consent_personalised === true ? 1 : null };
}

/* ---------- handlers ---------- */
async function createOrder(req: Request, env: Env) {
  const o = validateOrder(await readJson(req));
  const { n } = (await env.DB.prepare(
    "SELECT count(*) AS n FROM orders WHERE created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')",
  ).first<{ n: number }>())!;
  if (n >= MAX_ORDERS_PER_10_MIN) throw new HttpError(429, 'rate_limited');
  try {
    await env.DB.prepare(
      'INSERT INTO orders (id, customer, items, total_cents, lang, consent_terms, consent_personalised) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)',
    ).bind(o.id, o.customer, o.items, o.total, o.lang, o.personalised).run();
  } catch (e: any) {
    if (/UNIQUE|constraint/i.test(String(e && e.message))) throw new HttpError(409, 'invalid'); // duplicate id or CHECK failed
    throw e;
  }
  return { id: o.id };
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
    'SELECT id, created_at, status, customer, items, total_cents, consent_terms, consent_personalised FROM orders ORDER BY created_at DESC LIMIT 500',
  ).all<any>();
  return results.map((r) => ({
    ...r,
    customer: JSON.parse(r.customer),
    items: JSON.parse(r.items),
    consent_terms: r.consent_terms === 1,
    consent_personalised: r.consent_personalised === 1 ? true : null,
  }));
}

async function setStatus(req: Request, env: Env, id: string) {
  const b = await readJson(req);
  if (!UUID.test(id) || !isObj(b) || !STATUSES.includes(b.status)) throw new HttpError(400, 'invalid');
  const row = await env.DB.prepare('UPDATE orders SET status = ?1 WHERE id = ?2 RETURNING id, status').bind(b.status, id.toLowerCase()).first();
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}

/* ---------- router ---------- */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');
    try {
      if (req.method === 'OPTIONS') {
        if (!allowedOrigin(req, env)) return respond(null, 403, req, env);
        return respond(null, 204, req, env, {
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400',
        });
      }
      if (path === '' || path === '/api/health') return respond({ ok: true }, 200, req, env);

      // Browsers always send Origin on cross-site requests; refuse any that is not one of our sites.
      if (req.headers.get('Origin') && !allowedOrigin(req, env)) throw new HttpError(403, 'denied');

      if (path === '/api/orders' && req.method === 'POST') return respond(await createOrder(req, env), 201, req, env);
      if (path === '/api/admin/login' && req.method === 'POST') return respond(await login(req, env), 200, req, env);

      if (path.startsWith('/api/admin/')) {
        await requireAdmin(req, env);
        if (path === '/api/admin/logout' && req.method === 'POST') {
          await env.DB.prepare('DELETE FROM admin_sessions').run();
          return respond({ ok: true }, 200, req, env);
        }
        if (path === '/api/admin/orders' && req.method === 'GET') return respond(await listOrders(env), 200, req, env);
        const m = /^\/api\/admin\/orders\/([^/]+)$/.exec(path);
        if (m && req.method === 'PATCH') return respond(await setStatus(req, env, m[1]), 200, req, env);
      }
      throw new HttpError(404, 'not_found');
    } catch (e: any) {
      if (e instanceof HttpError) return respond({ error: e.code }, e.status, req, env);
      console.error('unhandled', e && e.message);
      return respond({ error: 'server' }, 500, req, env);
    }
  },
} satisfies ExportedHandler<Env>;
