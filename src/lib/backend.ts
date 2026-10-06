/* OFS/T order backend client: talks to the Cloudflare Worker in worker/ (which owns the D1 database) over plain fetch.
   Config comes from src/data/site.json (`apiUrl`, validated at build time by vite.config.ts). When it is empty,
   `configured` is false and the site falls back to "email us" (checkout) / setup instructions (admin).
   Security notes (see SECURITY.md and worker/src/index.ts):
   - The browser never reaches the database; the Worker validates every order and decides who is the admin.
   - The admin session is a random bearer token kept in sessionStorage (gone when the tab closes), never localStorage.
     The server stores only its hash and can revoke it (sign-out).
   - Prices are recomputed by the Worker from the same designs.json; a total sent from here would be ignored. Payment happens on Stripe's
     hosted page, and only Stripe's signed webhook marks an order paid. */
import SITE from '../data/site.json';
import type { Kit, Cfg } from './kit';

const URL_ = typeof SITE.apiUrl === 'string' && /^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(SITE.apiUrl.trim().replace(/\/$/, '')) ? SITE.apiUrl.trim().replace(/\/$/, '') : '';
export const backendConfigured = !!URL_;
const SESSION_KEY = 'ofst-admin-session';
const TIMEOUT = 15000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUUID = (s: unknown) => UUID.test(String(s));
const STATUSES = ['new', 'printed', 'shipped'];

export class BackendError extends Error {
  code: string;
  constructor(message: string, code?: string) { super(message); this.name = 'BackendError'; this.code = code || 'error'; }
}

/* ---------- Session (sessionStorage) ---------- */
const ss = {
  get() { try { const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); return s && typeof s.access_token === 'string' && Number.isFinite(+s.expires_at) ? s : null; } catch { return null; } },
  set(s: unknown) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* private mode */ } },
  clear() { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* private mode */ } },
};

/* Customer session: a random token the Worker issued after the emailed link was used (30 days). Kept in localStorage so the
   customer stays signed in; only its hash is stored server-side and "Sign out" revokes it there too. Never holds personal data. */
const CUSTOMER_KEY = 'ofst-customer-session';
export interface Customer { id: string; email: string; name: string | null; phone: string | null; street: string | null; postcode: string | null; city: string | null; country: string | null; lang: string | null }
const ls = {
  get() { try { const s = JSON.parse(localStorage.getItem(CUSTOMER_KEY) || 'null'); return s && typeof s.access_token === 'string' && Number.isFinite(+s.expires_at) && Date.now() < +s.expires_at ? s as { access_token: string; expires_at: number } : null; } catch { return null; } },
  set(s: unknown) { try { localStorage.setItem(CUSTOMER_KEY, JSON.stringify(s)); } catch { /* private mode */ } },
  clear() { try { localStorage.removeItem(CUSTOMER_KEY); } catch { /* private mode */ } },
};

export function makeBackend(kit: Kit) {
  const T = kit.T;
  /* Messages in the page language. */
  const MSG = {
    config: T('beConfig'), network: T('beNetwork'), timeout: T('beTimeout'), rate: T('beRate'), server: T('beServer'),
    payment: T('bePayment'), link: T('beLink'), mail: T('beMail'), invalid: T('beInvalid'), credentials: T('beCredentials'), session: T('beSession'), denied: T('beDenied'), generic: T('beGeneric'),
  };

  /* ---------- HTTP ---------- */
  async function request(path: string, { method = 'GET', body, token }: { method?: string; body?: unknown; token?: string } = {}) {
    if (!backendConfigured) throw new BackendError(MSG.config, 'not_configured');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const ctl = 'AbortController' in window ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT) : 0;
    let res: Response;
    try {
      res = await fetch(URL_ + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl ? ctl.signal : undefined, credentials: 'omit', cache: 'no-store', referrerPolicy: 'strict-origin-when-cross-origin' });
    } catch (e: any) {
      throw new BackendError(e && e.name === 'AbortError' ? MSG.timeout : MSG.network, e && e.name === 'AbortError' ? 'timeout' : 'network');
    } finally { clearTimeout(timer); }
    const text = await res.text().catch(() => '');
    let data: any = null;
    if (text) { try { data = JSON.parse(text); } catch { data = null; } }
    if (!res.ok) throw toError(res.status, data);
    return data;
  }
  /* Map the Worker's error codes to friendly messages. Server text is never shown verbatim. */
  function toError(status: number, d: any) {
    const code = String(d && typeof d === 'object' ? d.error || '' : '');
    if (status === 429 || code === 'rate_limited') return new BackendError(MSG.rate, 'rate_limited');
    if (code === 'invalid_link') return new BackendError(MSG.link, 'invalid_link');
    if (code === 'mail_unavailable') return new BackendError(MSG.mail, 'mail_unavailable');
    if (code === 'invalid_credentials') return new BackendError(MSG.credentials, 'invalid_credentials');
    if (code === 'session_expired' || status === 401) return new BackendError(MSG.session, 'session_expired');
    if (code === 'denied' || status === 403) return new BackendError(MSG.denied, 'denied');
    if (code === 'not_configured' || status === 503) return new BackendError(MSG.config, 'not_configured');
    if (code === 'payment_unavailable') return new BackendError(MSG.payment, 'payment_unavailable');
    if (status >= 500) return new BackendError(MSG.server, 'server');
    if (status === 400 || status === 404 || status === 409 || status === 413 || status === 415 || status === 422) return new BackendError(MSG.invalid, 'invalid');
    return new BackendError(MSG.generic, 'http_' + status);
  }

  /* ---------- Auth ---------- */
  /* The current session, or null when signed out / expired (sessions last 8 hours and are not refreshed). */
  async function getSession() {
    if (!backendConfigured) return null;
    const s = ss.get(); if (!s) return null;
    if (Date.now() >= +s.expires_at) { ss.clear(); return null; }
    return s;
  }
  async function signIn(email: string, password: string) {
    email = String(email || '').trim(); password = String(password || '');
    if (!email || !password) throw new BackendError(T('enterCreds'), 'missing');
    const r = await request('/api/admin/login', { method: 'POST', body: { email, password } });
    if (!r || typeof r.access_token !== 'string') throw new BackendError(MSG.generic, 'bad_response');
    const s = {
      access_token: r.access_token,
      expires_at: Date.now() + Math.max(60, +r.expires_in || 3600) * 1000,
      user: { id: '', email: r.user && typeof r.user.email === 'string' ? r.user.email : '' },
    };
    ss.set(s);
    return s;
  }
  /* Server-side sign-out: revokes every admin session, then clears the local copy (cleared even if the server can't be reached). */
  async function signOut() {
    const s = ss.get();
    try { if (s && backendConfigured) await request('/api/admin/logout', { method: 'POST', token: s.access_token }); }
    catch { /* already expired/revoked or offline: nothing more to do locally */ }
    finally { ss.clear(); }
  }
  /* Calls an admin endpoint. An expired or revoked token clears the session and asks for a new sign-in. */
  async function authed(path: string, opts: any = {}) {
    const s = await getSession();
    if (!s) throw new BackendError(MSG.session, 'session_expired');
    try { return await request(path, { ...opts, token: s.access_token }); }
    catch (e: any) { if (e.code === 'session_expired') ss.clear(); throw e; }
  }

  /* ---------- Orders ---------- */
  const clip = (v: unknown, n: number) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
  /* Sends the cart and form to the Worker, which re-validates every kit, prices it itself (nothing price-related is trusted from
     here) and opens a Stripe Checkout Session. Returns the Stripe-hosted payment page to send the customer to. */
  async function startCheckout(order: { customer: Record<string, string>; items: { cfg: Cfg; qty: number }[]; consentTerms: boolean; consentPersonalised: boolean | null }) {
    if (!backendConfigured) throw new BackendError(MSG.config, 'not_configured');
    const c = (order && order.customer) || {};
    const customer = { name: clip(c.name, 200), email: clip(c.email, 254), street: clip(c.street, 300), postcode: clip(c.postcode, 20), city: clip(c.city, 120), country: clip(c.country, 60) };
    if (Object.values(customer).some((v) => !v) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw new BackendError(MSG.invalid, 'invalid');
    const items: { cfg: Cfg; qty: number }[] = [];
    (Array.isArray(order.items) ? order.items : []).slice(0, 50).forEach((i) => {
      const cfg = i && kit.sanitizeCfg(i.cfg), qty = Math.min(99, Math.floor(+(i && i.qty)));
      if (cfg && qty >= 1) items.push({ cfg, qty });
    });
    if (!items.length) throw new BackendError(T('cartEmpty'), 'empty');
    if (order.consentTerms !== true) throw new BackendError(MSG.invalid, 'invalid');
    const body = { customer, items, lang: kit.lang, consent_terms: true, consent_personalised: order.consentPersonalised === true ? true : null };
    // A signed-in customer's order is attached to their account; the Worker ignores an invalid token and treats it as a guest.
    const r = await request('/api/checkout', { method: 'POST', body, token: ls.get()?.access_token });
    // Only ever follow a link to Stripe's own checkout domain.
    let url: URL | null = null;
    try { url = new URL(String(r && r.url)); } catch { url = null; }
    if (!r || !url || url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new BackendError(MSG.payment, 'bad_response');
    return { id: String(r.id), url: url.href };
  }
  /* Payment status of an order (the "thank you" page polls this): 'unpaid' | 'paid' | 'failed' | 'expired' | 'mismatch'. */
  async function orderStatus(id: string): Promise<string | null> {
    if (!UUID.test(String(id))) return null;
    try { const r = await request('/api/orders/' + encodeURIComponent(id) + '/status'); return r && typeof r.payment_status === 'string' ? r.payment_status : null; }
    catch (e: any) { if (e.code === 'invalid') return null; throw e; }
  }
  /* ---------- Customer account ---------- */
  const hasCustomerSession = () => backendConfigured && !!ls.get();
  async function customerCall(path: string, opts: { method?: string; body?: unknown } = {}) {
    const s = ls.get();
    if (!s) throw new BackendError(MSG.session, 'session_expired');
    try { return await request(path, { ...opts, token: s.access_token }); }
    catch (e: any) { if (e.code === 'session_expired') ls.clear(); throw e; }
  }
  /* Emails a one-time sign-in link (the answer is the same whether or not the address already has an account). */
  async function requestLink(email: string) {
    email = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BackendError(T('badEmail'), 'invalid');
    await request('/api/auth/request', { method: 'POST', body: { email, lang: kit.lang } });
  }
  /* Uses the token from the emailed link; on success the customer is signed in. */
  async function verifyLink(token: string): Promise<Customer> {
    const r = await request('/api/auth/verify', { method: 'POST', body: { token, lang: kit.lang } });
    if (!r || typeof r.access_token !== 'string' || !r.user) throw new BackendError(MSG.generic, 'bad_response');
    ls.set({ access_token: r.access_token, expires_at: Date.now() + Math.max(60, +r.expires_in || 3600) * 1000 });
    return r.user as Customer;
  }
  const me = async (): Promise<Customer> => customerCall('/api/me');
  const saveProfile = async (fields: Partial<Omit<Customer, 'id' | 'email' | 'lang'>>): Promise<Customer> => customerCall('/api/me', { method: 'PATCH', body: fields });
  const myOrders = async (): Promise<any[]> => { const r = await customerCall('/api/me/orders'); return Array.isArray(r) ? r : []; };
  async function customerSignOut() {
    try { if (ls.get()) await customerCall('/api/auth/logout', { method: 'POST' }); }
    catch { /* already expired or offline: the local copy is cleared below either way */ }
    finally { ls.clear(); }
  }
  async function deleteAccount() { await customerCall('/api/me', { method: 'DELETE' }); ls.clear(); }

  /* Only an admin session can list orders; any non-expired session here is the admin (there is a single owner account). */
  async function isAdmin() {
    return !!(await getSession());
  }
  async function listOrders(): Promise<any[]> {
    const rows = await authed('/api/admin/orders');
    return Array.isArray(rows) ? rows : [];
  }
  async function setStatus(id: string, status: string) {
    if (!UUID.test(String(id)) || !STATUSES.includes(status)) throw new BackendError(MSG.invalid, 'invalid');
    const row = await authed('/api/admin/orders/' + encodeURIComponent(id), { method: 'PATCH', body: { status } });
    if (!row || typeof row !== 'object') throw new BackendError(MSG.denied, 'denied');
    return row;
  }
  return { configured: backendConfigured, email: typeof SITE.email === 'string' ? SITE.email : '', BackendError, startCheckout, orderStatus, hasCustomerSession, requestLink, verifyLink, me, saveProfile, myOrders, customerSignOut, deleteAccount, signIn, signOut, getSession, isAdmin, listOrders, setStatus };
}
export type Backend = ReturnType<typeof makeBackend>;
