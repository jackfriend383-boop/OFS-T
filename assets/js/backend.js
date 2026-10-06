/* OFS/T order backend client: Supabase REST (PostgREST) + Auth (GoTrue) over plain fetch. No library.
   Config comes from assets/js/config.js (generated from src/data/site.json). When it is empty, O.backend.configured is false
   and the site falls back to "email us" (checkout) / setup instructions (admin).
   Security notes (see SECURITY.md and supabase/schema.sql):
   - Only the public anon/publishable key is ever in the site. Access control is Row Level Security in the database.
   - Who the admin is comes from the signed-in session's JWT (auth.uid() in RLS), never from anything put in a request body.
   - The admin session (access + refresh token) lives in sessionStorage (gone when the tab closes), never localStorage.
   - Order totals are recomputed here from designs.json; the database cannot verify them, so the owner checks totals before charging. */
(() => {
'use strict';
const O = window.OFST = window.OFST || {};
const CFG = window.OFST_CONFIG || {};
const URL_ = typeof CFG.supabaseUrl === 'string' && /^https:\/\/[a-z0-9.-]+$/.test(CFG.supabaseUrl) ? CFG.supabaseUrl : '';
const KEY = typeof CFG.supabaseAnonKey === 'string' ? CFG.supabaseAnonKey : '';
const configured = !!(URL_ && KEY);
const SESSION_KEY = 'ofst-admin-session';
const TIMEOUT = 15000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['new', 'printed', 'shipped'];

class BackendError extends Error {
  constructor(message, code){ super(message); this.name = 'BackendError'; this.code = code || 'error'; }
}
/* Messages in the page language (assets/js/i18n.js, loaded before this file). */
const T = window.OFST_T || (k => k);
const MSG = {
  config: T('beConfig'), network: T('beNetwork'), timeout: T('beTimeout'), rate: T('beRate'), server: T('beServer'),
  invalid: T('beInvalid'), credentials: T('beCredentials'), session: T('beSession'), denied: T('beDenied'), generic: T('beGeneric')
};

/* ---------- Session (sessionStorage) ---------- */
const ss = {
  get(){ try { const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); return s && typeof s.access_token === 'string' && typeof s.refresh_token === 'string' ? s : null; } catch(e) { return null; } },
  set(s){ try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch(e) {} },
  clear(){ try { sessionStorage.removeItem(SESSION_KEY); } catch(e) {} }
};
/* Keep only what is needed. expires_at is computed locally from expires_in (seconds). */
function storeSession(r){
  if(!r || typeof r.access_token !== 'string' || typeof r.refresh_token !== 'string') throw new BackendError(MSG.generic, 'bad_response');
  const s = {
    access_token: r.access_token, refresh_token: r.refresh_token,
    expires_at: Date.now() + Math.max(60, +r.expires_in || 3600) * 1000,
    user: {id: r.user && typeof r.user.id === 'string' ? r.user.id : '', email: r.user && typeof r.user.email === 'string' ? r.user.email : ''}
  };
  ss.set(s);
  return s;
}

/* ---------- HTTP ---------- */
async function request(path, {method = 'GET', body, token, prefer} = {}){
  if(!configured) throw new BackendError(MSG.config, 'not_configured');
  const headers = {apikey: KEY, Accept: 'application/json'};
  // Signed in: the user's JWT (RLS sees auth.uid()). Anonymous: legacy anon JWT keys also go in Authorization;
  // new sb_publishable_ keys must not (the gateway handles them from the apikey header).
  if(token) headers.Authorization = 'Bearer ' + token;
  else if(/^eyJ/.test(KEY)) headers.Authorization = 'Bearer ' + KEY;
  if(body !== undefined) headers['Content-Type'] = 'application/json';
  if(prefer) headers.Prefer = prefer;
  const ctl = 'AbortController' in window ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT) : 0;
  let res;
  try {
    res = await fetch(URL_ + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl ? ctl.signal : undefined, credentials: 'omit', cache: 'no-store', referrerPolicy: 'strict-origin-when-cross-origin'});
  } catch(e) {
    throw new BackendError(e && e.name === 'AbortError' ? MSG.timeout : MSG.network, e && e.name === 'AbortError' ? 'timeout' : 'network');
  } finally { clearTimeout(timer); }
  const text = await res.text().catch(() => '');
  let data = null;
  if(text){ try { data = JSON.parse(text); } catch(e) { data = null; } }
  if(!res.ok) throw toError(res.status, data);
  return data;
}
/* Map HTTP / PostgREST / GoTrue errors to friendly messages. Server text is never shown verbatim. */
function toError(status, d){
  d = d && typeof d === 'object' ? d : {};
  const code = String(d.error_code || d.error || d.code || '');
  if(status === 429 || d.hint === 'rate_limited' || /rate_limit/.test(code)) return new BackendError(MSG.rate, 'rate_limited');
  if(code === 'invalid_grant' || code === 'invalid_credentials') return new BackendError(MSG.credentials, 'invalid_credentials');
  if(code === 'PGRST301' || code === 'PGRST303' || code === 'bad_jwt' || code === 'session_not_found' || code === 'refresh_token_not_found' || code === 'refresh_token_already_used')
    return new BackendError(MSG.session, 'session_expired');
  if(code === '42501' || status === 403) return new BackendError(MSG.denied, 'denied');
  if(status === 401) return new BackendError(MSG.session, 'session_expired');
  if(status >= 500) return new BackendError(MSG.server, 'server');
  if(status === 400 || status === 409 || status === 422 || /^(22|23)/.test(code)) return new BackendError(MSG.invalid, 'invalid');
  return new BackendError(MSG.generic, 'http_' + status);
}

/* ---------- Auth ---------- */
let refreshing = null;
async function refresh(s){
  if(!refreshing) refreshing = request('/auth/v1/token?grant_type=refresh_token', {method:'POST', body:{refresh_token: s.refresh_token}})
    .then(storeSession)
    .catch(e => { if(e.code !== 'network' && e.code !== 'timeout') ss.clear(); throw e; })
    .finally(() => { refreshing = null; });
  return refreshing;
}
/* The current session, refreshed when it expires within a minute. null when signed out. */
async function getSession(){
  if(!configured) return null;
  const s = ss.get(); if(!s) return null;
  if(Date.now() < (+s.expires_at || 0) - 60000) return s;
  try { return await refresh(s); }
  catch(e) { if(e.code === 'network' || e.code === 'timeout') throw e; return null; }
}
async function signIn(email, password){
  email = String(email || '').trim(); password = String(password || '');
  if(!email || !password) throw new BackendError(T('enterCreds'), 'missing');
  const r = await request('/auth/v1/token?grant_type=password', {method:'POST', body:{email, password}});
  return storeSession(r);
}
/* Server-side sign-out: revokes the refresh tokens of every session of this user (scope=global), then clears the local copy.
   The local copy is cleared even if the server can't be reached; the short-lived access token then simply expires. */
async function signOut(){
  const s = ss.get();
  try { if(s && configured) await request('/auth/v1/logout?scope=global', {method:'POST', token:s.access_token}); }
  catch(e) { /* already expired/revoked or offline: nothing more to do locally */ }
  finally { ss.clear(); }
}
/* Calls an authenticated endpoint; on an expired token, refreshes once and retries. */
async function authed(path, opts = {}){
  let s = await getSession();
  if(!s) throw new BackendError(MSG.session, 'session_expired');
  try { return await request(path, {...opts, token:s.access_token}); }
  catch(e) {
    if(e.code !== 'session_expired') throw e;
    s = await refresh(s).catch(() => null);
    if(!s) throw new BackendError(MSG.session, 'session_expired');
    return request(path, {...opts, token:s.access_token});
  }
}

/* ---------- Orders ---------- */
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
/* Builds the row from the cart and form. Every kit is re-validated (O.sanitizeCfg) and priced from designs.json
   (O.priceOf); nothing price-related is read from storage. The customer gets an order reference (client-made uuid). */
async function submitOrder(order){
  if(!configured) throw new BackendError(MSG.config, 'not_configured');
  if(!O.sanitizeCfg || !O.priceOf || !O.D) throw new BackendError(MSG.generic, 'not_ready');
  const c = (order && order.customer) || {};
  const customer = {name:clip(c.name, 200), email:clip(c.email, 254), street:clip(c.street, 300), postcode:clip(c.postcode, 20), city:clip(c.city, 120), country:clip(c.country, 60)};
  if(Object.values(customer).some(v => !v) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw new BackendError(MSG.invalid, 'invalid');
  const items = [];
  (Array.isArray(order.items) ? order.items : []).slice(0, 50).forEach(i => {
    const cfg = i && O.sanitizeCfg(i.cfg), qty = Math.min(99, Math.floor(+(i && i.qty)));
    if(!cfg || !(qty >= 1)) return;
    const unit = Math.round(O.priceOf(cfg) * 100);
    items.push({cfg:{model:cfg.model, design:cfg.design, c1:cfg.c1, c2:cfg.c2, finish:cfg.finish, kit:cfg.kit, numberOn:cfg.numberOn, number:cfg.numberOn ? cfg.number : ''},
      qty, unit_cents:unit, name:O.D(cfg.design).name, desc:O.descOf ? O.descOf(cfg) : ''});
  });
  if(!items.length) throw new BackendError(T('cartEmpty'), 'empty');
  const total_cents = items.reduce((s, i) => s + i.unit_cents * i.qty, 0);
  if(order.consentTerms !== true) throw new BackendError(MSG.invalid, 'invalid');
  const id = crypto && crypto.randomUUID ? crypto.randomUUID() : null;
  const row = {customer, items, total_cents, lang:(document.documentElement.lang || 'en').slice(0, 5), consent_terms:true,
    consent_personalised: order.consentPersonalised === true ? true : null};
  if(id) row.id = id;
  // return=minimal: anonymous visitors may insert but never read orders back.
  await request('/rest/v1/orders', {method:'POST', body:row, prefer:'return=minimal'});
  return {id, ref: id ? id.slice(-6).toUpperCase() : '', total_cents};
}
/* Admin only (RLS): an account that isn't in public.admins gets an empty list, never an error. */
async function isAdmin(){
  const s = await getSession(); if(!s || !UUID.test(s.user.id)) return false;
  const rows = await authed('/rest/v1/admins?select=user_id&user_id=eq.' + s.user.id);
  return Array.isArray(rows) && rows.length > 0;
}
async function listOrders(){
  const rows = await authed('/rest/v1/orders?select=id,created_at,status,customer,items,total_cents,consent_terms,consent_personalised&order=created_at.desc&limit=500');
  return Array.isArray(rows) ? rows : [];
}
async function setStatus(id, status){
  if(!UUID.test(String(id)) || !STATUSES.includes(status)) throw new BackendError(MSG.invalid, 'invalid');
  const rows = await authed('/rest/v1/orders?id=eq.' + encodeURIComponent(id), {method:'PATCH', body:{status}, prefer:'return=representation'});
  if(!Array.isArray(rows) || !rows.length) throw new BackendError(MSG.denied, 'denied'); // RLS filtered it out
  return rows[0];
}

O.backend = Object.freeze({configured, email: typeof CFG.email === 'string' ? CFG.email : '', BackendError,
  submitOrder, signIn, signOut, getSession, isAdmin, listOrders, setStatus});
})();
