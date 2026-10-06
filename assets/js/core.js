/* OFS/T shared runtime: helpers, theme toggle, header nav ink, mobile menu, cart + drawer + checkout, search, toast,
   modal dialog handling (focus in, focus trap, Esc, focus return, inert background) and polite screen-reader announcements.
   Loaded on every page after data.js (generated from src/data/designs.json). Exposes window.OFST for the other scripts. */
(() => {
'use strict';
const O = window.OFST = window.OFST || {};
const DATA = window.OFST_DATA;
if(!DATA || !Array.isArray(DATA.designs) || !DATA.colors) return;

/* Strings come from assets/js/i18n.js (generated from src/i18n/*.json), chosen by <html lang>. */
const T = window.OFST_T || Object.assign((k, v) => k, {n: k => k, raw: () => null, lang: 'en', price: v => '€' + v, cat: c => c});
const LANG = T.lang;

/* Site root as an absolute URL, derived from this script's own URL (assets/js/core.js). Works at any page depth and on 404.html.
   Assets are shared at ROOT; pages of the current language live under LANG_ROOT (pt-PT at the root, English under en/). */
const me = document.currentScript;
const ROOT = new URL('../../', me && me.src ? me.src : location.href).href;
const LANG_ROOT = LANG === 'en' ? ROOT + 'en/' : ROOT;

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const mq = q => window.matchMedia ? matchMedia(q) : {matches:false, addEventListener(){}};
const reduce = mq('(prefers-reduced-motion: reduce)').matches;
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {
  get: k => { try { return localStorage.getItem(k); } catch(e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch(e) {} }
};
const on = (sel, ev, fn) => { const el = typeof sel === 'string' ? $(sel) : sel; if(el) el.addEventListener(ev, fn); return el; };

/* ---------- Data ---------- */
const COLORS = DATA.colors, DESIGNS = DATA.designs, EXTRA = DATA.extras || {secondSide:0, badge:0};
const D = id => DESIGNS.find(d => d.id === id);
const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
/* Ami versions offered in the configurator. Everything else shows the QuickSilver; configs without a model are QuickSilver. */
const MODELS = {qs:'Ami QuickSilver', pop:'Ami Pop'};
const modelName = m => has(MODELS, m) ? MODELS[m] : MODELS.qs;
const defaultCfg = d => ({model:'qs', design:d.id, c1:d.c1, c2:d.c2, finish:'matte', kit:'one', numberOn:false, number:'AMI'});
const cleanNumber = v => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9 .#&!-]/g, '').slice(0, 8);

/* Validate a config from an untrusted source (query string, localStorage). Returns a full config or null. */
function sanitizeCfg(c){
  if(!c || typeof c !== 'object') return null;
  const d = D(c.design); if(!d) return null;
  const out = defaultCfg(d);
  if(has(MODELS, c.model)) out.model = c.model;
  if(has(COLORS, c.c1)) out.c1 = c.c1;
  if(has(COLORS, c.c2)) out.c2 = c.c2;
  if(c.finish === 'matte' || c.finish === 'gloss') out.finish = c.finish;
  if(c.kit === 'one' || c.kit === 'both') out.kit = c.kit;
  if(typeof c.number === 'string') out.number = cleanNumber(c.number);
  out.numberOn = !!c.numberOn && !!out.number;
  if(!out.numberOn && !out.number) out.number = 'AMI';
  return out;
}

/* A kit is personalised (made to the buyer's choices, so no change-of-mind returns) when it carries badge text,
   or when its colours differ from the design's defaults. Fixed-colour artwork never counts via colour. */
function isPersonalised(c){
  const d = c && D(c.design); if(!d) return false;
  if(c.numberOn && c.number) return true;
  return !d.fixed && (c.c1 !== d.c1 || c.c2 !== d.c2);
}

/* ---------- URLs ---------- */
const designURL = id => LANG_ROOT + 'configurator/?design=' + encodeURIComponent(id);
const cfgQuery = c => {
  const p = new URLSearchParams({design:c.design, c1:c.c1, c2:c.c2, finish:c.finish, kit:c.kit});
  if(c.numberOn && c.number) p.set('number', c.number);
  if(c.model && c.model !== 'qs') p.set('model', c.model);
  return p.toString();
};
const editURL = c => LANG_ROOT + 'configurator/?' + cfgQuery(c);
const normPath = p => p.replace(/index\.html$/, '');

/* ---------- Screen-reader announcements ---------- */
/* Polite live regions: #live (page), #cartLive (inside the cart dialog), #sresCount (inside the search dialog).
   Clearing first makes a repeated identical message be read again. */
const liveT = {};
function announce(msg, id = 'live'){
  const el = document.getElementById(id); if(!el) return;
  el.textContent = ''; clearTimeout(liveT[id]);
  liveT[id] = setTimeout(() => { el.textContent = msg; }, 80);
}

/* ---------- Car thumbnails (car.js). Pages without car.js load it on demand for the cart and search thumbnails. ---------- */
const PH = '<svg class="car-svg" viewBox="556 272 1032 594" aria-hidden="true" focusable="false"></svg>'; // same aspect ratio as a thumbnail
let carP = null;
function ensureCar(){
  if(O.thumb) return Promise.resolve();
  if(!carP) carP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = ROOT + 'assets/js/car.js';
    s.onload = () => O.thumb ? res() : rej(); s.onerror = rej;
    document.head.append(s);
  });
  return carP;
}
const thumbOr = cfg => O.thumb ? O.thumb(cfg, true) : PH; // decorative: the link/option around it carries the name

/* ---------- Modal dialogs (cart drawer, search) ---------- */
const INERT_OK = 'inert' in HTMLElement.prototype;
const KEEP = new Set(['drawer', 'search', 'scrim', 'toast', 'live']);
let modal = null; // {el, opener}
function setBackground(off){
  [...document.body.children].forEach(el => {
    if(KEEP.has(el.id) || /^(SCRIPT|STYLE|TEMPLATE)$/.test(el.tagName)) return;
    if(off){
      if(el.hasAttribute('inert')) return;
      el.setAttribute('inert', ''); el.dataset.ofstInert = '1';
      if(!INERT_OK) el.setAttribute('aria-hidden', 'true');
    } else if(el.dataset.ofstInert){
      el.removeAttribute('inert'); delete el.dataset.ofstInert;
      if(!INERT_OK) el.removeAttribute('aria-hidden');
    }
  });
}
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const focusables = el => $$(FOCUSABLE, el).filter(x => x.getClientRects().length && getComputedStyle(x).visibility !== 'hidden');
function focusEl(el){ if(el && el.focus) try { el.focus({preventScroll:true}); } catch(e) { el.focus(); } }
function openModal(el, target){
  if(!el) return;
  let opener = document.activeElement;
  if(modal){ opener = modal.opener; if(modal.el !== el) modal.el.classList.remove('on'); }
  if(!opener || opener === document.body || opener.id === 'toastBtn' || el.contains(opener)) opener = $(el.id === 'search' ? '#openSearch' : '#openCart');
  modal = {el, opener};
  setMenu(false);
  el.classList.add('on');
  const scrim = $('#scrim'); if(scrim) scrim.classList.add('on');
  setBackground(true);
  focusEl(target || focusables(el)[0] || el);
}
function closeModal(restore = true){
  if(!modal) return;
  const {el, opener} = modal; modal = null;
  el.classList.remove('on');
  const scrim = $('#scrim'); if(scrim) scrim.classList.remove('on');
  setBackground(false);
  if(restore && opener && document.contains(opener)) focusEl(opener);
}
const isOpen = id => !!modal && modal.el.id === id;

/* ---------- Cart (localStorage, shared by every page). Only kit configurations are stored, never personal data. ---------- */
const CART_KEY = 'amig-cart';
let cart = [];
function loadCart(){
  let raw = [];
  try { raw = JSON.parse(store.get(CART_KEY) || '[]'); } catch(e) { raw = []; }
  if(!Array.isArray(raw)) raw = [];
  cart = [];
  raw.slice(0, 50).forEach(i => {
    const c = i && sanitizeCfg(i.cfg), q = i ? Math.floor(+i.qty) : 0;
    if(!c || !(q >= 1)) return;
    const k = keyOf(c), hit = cart.find(x => x.key === k);
    if(hit) hit.qty = Math.min(hit.qty + q, 99); else cart.push({key:k, cfg:c, qty:Math.min(q, 99)});
  });
}
const saveCart = () => store.set(CART_KEY, JSON.stringify(cart));
const priceOf = c => D(c.design).price + (c.kit === 'both' ? EXTRA.secondSide : 0) + (c.numberOn && c.number ? EXTRA.badge : 0);
const keyOf = c => [c.design,c.c1,c.c2,c.finish,c.kit,c.numberOn ? c.number : '',c.model || 'qs'].join('|');
const colourLabel = c => D(c.design).fixed ? T('originalColours') : `${COLORS[c.c1].name} / ${COLORS[c.c2].name}`;
const descOf = c => `${modelName(c.model)} · ${colourLabel(c)} · ${T(c.finish === 'gloss' ? 'gloss' : 'matte')} · ${T(c.kit === 'both' ? 'bothSides' : 'oneSide')}${c.numberOn && c.number ? ' · ' + T('badgeDesc', {text:c.number}) : ''}${isPersonalised(c) ? ' · ' + T('personalised') : ''}`;
const count = () => cart.reduce((s,i) => s + i.qty, 0);
const money = T.price;

function renderBadge(){
  const n = count(), b = $('#cartCount'), btn = $('#openCart');
  if(b) b.textContent = n;
  if(btn) btn.setAttribute('aria-label', n ? T.n('openCart', n) : T('openCartEmpty'));
}

function addToCart(c){
  c = sanitizeCfg(c); if(!c) return;
  const k = keyOf(c), hit = cart.find(i => i.key === k);
  if(hit) hit.qty = Math.min(hit.qty + 1, 99); else cart.push({key:k, cfg:{...c}, qty:1});
  saveCart(); renderCart();
  const b = $('#cartCount');
  if(b){ b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
  toast(T('addedToCart', {name:D(c.design).name}));
}
let drawerMode = 'cart';
function setTitle(t){ const h = $('#drawerTitle'); if(h) h.textContent = t; }
function renderCart(){
  renderBadge();
  const body = $('#cartBody'), foot = $('#cartFoot');
  if(!body || !foot) return;
  drawerMode = 'cart';
  setTitle(T('cartTitle'));
  if(!cart.length){
    body.innerHTML = `<div class="empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true" focusable="false"><path d="M3 4h2.2l2.3 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L20.6 8H6.1"/></svg><span>${esc(T('cartEmpty'))}</span><a class="btn btn-primary" href="${esc(LANG_ROOT)}configurator/" data-close>${esc(T('designKit'))}</a></div>`;
    foot.innerHTML = ''; return;
  }
  body.innerHTML = '<ul class="citems" role="list">' + cart.map((i,ix) => {
    const name = D(i.cfg.design).name, n = esc(name), t = k => esc(T(k, {name}));
    return `<li class="citem"><a class="mini" href="${esc(editURL(i.cfg))}" data-edit="${ix}" title="${esc(T('editTitle'))}" aria-label="${t('editAria')}">${thumbOr(i.cfg)}</a>
    <div><h3>${n}</h3><p>${esc(descOf(i.cfg))}</p>
    <div class="citem-row"><div class="qty" role="group" aria-label="${t('qtyGroup')}"><button type="button" data-q="${ix}" data-d="-1" aria-label="${t('qtyDec')}">−</button><span>${i.qty}</span><button type="button" data-q="${ix}" data-d="1" aria-label="${t('qtyInc')}"${i.qty >= 99 ? ' disabled' : ''}>+</button></div>
    <span class="price">${esc(money(priceOf(i.cfg) * i.qty))}</span></div>
    <button type="button" class="rm" data-rm="${ix}" style="margin-top:8px">${esc(T('remove'))}<span class="sr">${t('removeSr')}</span></button></div></li>`;
  }).join('') + '</ul>';
  const sub = cart.reduce((s,i) => s + priceOf(i.cfg) * i.qty, 0);
  foot.innerHTML = `<div class="row"><span class="muted">${esc(T('subtotal'))}</span><span class="price">${esc(money(sub))}</span></div>
    <div class="row"><span class="muted">${esc(T('shipping'))}</span><span class="price">${esc(T('shippingCalc'))}</span></div>
    <div class="row big"><span>${esc(T('total'))}</span><span class="price">${esc(money(sub))}</span></div>
    <button type="button" class="btn btn-primary" id="checkout">${esc(T('checkout'))}</button>`;
  if(!O.thumb) ensureCar().then(() => {
    $$('#cartBody .citem .mini[data-edit]').forEach(el => { const i = cart[+el.dataset.edit]; if(i) el.innerHTML = O.thumb(i.cfg, true); });
  }).catch(() => {});
}

/* ---------- Checkout (sent to the order backend when configured; see the submit handler) ---------- */
/* Country: the option value stays the English name (what the order record and the admin see); the label is translated. */
const COUNTRIES_EN = ['Portugal','Spain','France','Italy','Germany','Netherlands','Belgium'];
const countryLabels = (() => { const l = T.raw('countries'); return Array.isArray(l) && l.length === COUNTRIES_EN.length ? l : COUNTRIES_EN; })();
const FIELDS = [
  {id:'coName', label:'fName', ac:'name', extra:'autocapitalize="words"', msg:'fNameMsg'},
  {id:'coEmail', label:'fEmail', ac:'email', type:'email', extra:'inputmode="email" autocapitalize="off" spellcheck="false"', msg:'fEmailMsg'},
  {id:'coAddr', label:'fAddr', ac:'address-line1', msg:'fAddrMsg'},
  {id:'coPost', label:'fPost', ac:'postal-code', extra:'autocapitalize="characters" spellcheck="false"', msg:'fPostMsg'},
  {id:'coCity', label:'fCity', ac:'address-level2', msg:'fCityMsg'}
];
const MSG = {coTerms:T('msgTerms'), coPers:T('msgPers')};
FIELDS.forEach(f => { MSG[f.id] = T(f.msg); });
const field = f => `<div class="co-f"><label for="${f.id}">${esc(T(f.label))}</label><input class="field" id="${f.id}" name="${f.ac}" type="${f.type || 'text'}" autocomplete="${f.ac}" required ${f.extra || ''}><p class="err" id="${f.id}Err" hidden></p></div>`;
const check = (id, html) => `<div class="co-f"><div class="co-check"><input type="checkbox" id="${id}" required><label for="${id}">${html}</label></div><p class="err" id="${id}Err" hidden></p></div>`;
const newTab = `<span class="sr">${esc(T('newTab'))}</span>`;
/* Link texts in the dictionary are HTML (e.g. "refunds &amp; returns policy"). */
const legalLink = (path, text) => `<a href="${esc(LANG_ROOT + path)}" target="_blank" rel="noopener">${text}${newTab}</a>`;

function renderCheckout(){
  const body = $('#cartBody'), foot = $('#cartFoot'); if(!body) return;
  drawerMode = 'checkout';
  setTitle(T('checkout'));
  const pers = cart.some(i => isPersonalised(i.cfg));
  // With real payment the submit button must read "Place order with obligation to pay" (EU Consumer Rights Directive, art. 8(2)).
  body.innerHTML = `<form class="co" id="coForm" novalidate aria-describedby="coNote">
    ${field(FIELDS[0])}${field(FIELDS[1])}${field(FIELDS[2])}
    <div class="co-2">${field(FIELDS[3])}${field(FIELDS[4])}</div>
    <div class="co-f"><label for="coCountry">${esc(T('fCountry'))}</label><select class="field" id="coCountry" name="country" autocomplete="country-name" required>${COUNTRIES_EN.map((c, i) => `<option value="${esc(c)}">${esc(countryLabels[i])}</option>`).join('')}</select></div>
    ${check('coTerms', T('termsCheck', {terms:legalLink('terms/', T('termsLink')), refunds:legalLink('refunds/', T('refundsLink')), privacy:legalLink('privacy/', T('privacyLink'))}))}
    ${pers ? check('coPers', esc(T('persCheck'))) : ''}
    <p class="note" id="coNote">${backendOn() ? esc(T('noPayment')) : notSetUp()}</p>
    <div id="coStatus" role="alert"></div>
    <button class="btn btn-primary" type="submit">${esc(T('placeOrder'))}</button>
    <button class="btn btn-ghost" type="button" id="coBack">${esc(T('backToCart'))}</button></form>`;
  if(foot) foot.innerHTML = '';
}
function validate(el){
  let msg = '';
  if(el.type === 'checkbox') msg = el.checked ? '' : MSG[el.id];
  else {
    const v = el.value.trim();
    if(!v) msg = MSG[el.id] || T('required');
    else if(el.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) msg = T('badEmail');
  }
  const err = document.getElementById(el.id + 'Err');
  if(err){ err.textContent = msg; err.hidden = !msg; }
  if(msg){ el.setAttribute('aria-invalid', 'true'); el.setAttribute('aria-describedby', el.id + 'Err'); }
  else { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); }
  return !msg;
}
/* Orders go to Supabase through assets/js/backend.js (O.backend). Without a backend the form says so and keeps the cart. */
const backendOn = () => !!(O.backend && O.backend.configured);
const mailLink = () => {
  const m = O.backend && O.backend.email || '';
  if(/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(m)) return `<a href="mailto:${esc(m)}">${esc(m)}</a>`;
  return esc(/^\[.*\]$/.test(m) ? T('emailPlaceholder') : m || T('ourContact')); // unfilled [CONTACT EMAIL] placeholder: shown translated
};
const notSetUp = () => esc(T('notSetUp', {email:'\u0000'})).replace('\u0000', mailLink());
let sending = false;
document.addEventListener('submit', async e => {
  if(!e.target || e.target.id !== 'coForm') return;
  e.preventDefault();
  const form = e.target, status = $('#coStatus', form), btn = $('button[type="submit"]', form);
  const say = (html, cls) => { if(status){ status.className = cls; status.innerHTML = html; } };
  const bad = $$('input[required],select[required]', form).filter(el => !validate(el));
  if(bad.length){ focusEl(bad[0]); return; }
  if(!backendOn()){ say(notSetUp(), 'note'); return; }
  if(sending) return;
  const val = id => (($('#' + id, form) || {}).value || '').trim();
  const first = val('coName').split(/\s+/)[0];
  const pers = $('#coPers', form);
  sending = true; say('', ''); if(btn){ btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = T('sending'); }
  let res;
  try {
    res = await O.backend.submitOrder({
      customer:{name:val('coName'), email:val('coEmail'), street:val('coAddr'), postcode:val('coPost'), city:val('coCity'), country:val('coCountry')},
      items:cart.map(i => ({cfg:{...i.cfg}, qty:i.qty})),
      consentTerms:!!($('#coTerms', form) || {}).checked, consentPersonalised:pers ? pers.checked : null
    });
  } catch(err) {
    const msg = err && err.code === 'denied' ? T('orderDenied') : (err && err.message || T('somethingWrong'));
    say(esc(T('orderFailed', {msg, email:'\u0000'})).replace('\u0000', mailLink()), 'err');
    if(btn){ btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = T('placeOrder'); }
    return;
  } finally { sending = false; }
  cart = []; saveCart(); renderBadge();
  drawerMode = 'ok';
  setTitle(T('orderReceived'));
  const refLine = res && res.ref ? esc(T('refLine', {ref:'\u0000'})).replace('\u0000', `<b class="mono">${esc(res.ref)}</b>`) : '';
  $('#cartBody').innerHTML = `<div class="ok"><span class="tick" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" focusable="false"><path d="m5 12 5 5 9-10"/></svg></span><h3 style="margin:0">${esc(T('thanks', {name:first}))}</h3><p class="muted" style="margin:0;max-width:32ch">${esc(T('receivedBody'))}${refLine}</p><p class="note" style="margin:0;max-width:32ch">${esc(T('noPaymentShort'))}</p></div>`;
  $('#cartFoot').innerHTML = '';
  focusEl($('#drawerTitle'));
});
/* Re-check a field as it's corrected, once it has been flagged. */
['input', 'change'].forEach(ev => document.addEventListener(ev, e => {
  const el = e.target;
  if(el && el.closest && el.closest('#coForm') && el.getAttribute('aria-invalid') === 'true') validate(el);
}));

function openCart(){ renderCart(); openModal($('#drawer'), $('#closeCart')); }
on('#openCart', 'click', openCart);
on('#closeCart', 'click', () => closeModal());
on('#scrim', 'click', () => closeModal());
on('#drawer', 'click', e => {
  const t = e.target.closest('button,a'); if(!t) return;
  const ds = t.dataset;
  if(ds.q){
    const ix = +ds.q, i = cart[ix]; if(!i) return;
    const name = D(i.cfg.design).name;
    i.qty = Math.min(99, i.qty + (+ds.d || 0));
    if(i.qty < 1){ cart.splice(ix, 1); saveCart(); renderCart(); focusEl($('#drawerTitle')); announce(T('removed', {name}), 'cartLive'); return; }
    saveCart(); renderCart();
    focusEl($(`#cartBody [data-q="${ix}"][data-d="${ds.d}"]:not([disabled])`) || $(`#cartBody [data-q="${ix}"]`));
    announce(T('qtyNow', {name, n:i.qty}), 'cartLive');
  }
  else if(ds.rm){
    const i = cart[+ds.rm]; if(!i) return;
    cart.splice(+ds.rm, 1); saveCart(); renderCart();
    focusEl($('#cartBody .rm') || $('#drawerTitle'));
    announce(T('removed', {name:D(i.cfg.design).name}), 'cartLive');
  }
  else if(ds.edit){
    const i = cart[+ds.edit]; if(!i) return;
    if(O.onEditConfig){ e.preventDefault(); O.onEditConfig({...i.cfg}); closeModal(); }
    // otherwise the link navigates to the configurator with the config in the query string
  }
  else if(t.id === 'checkout'){ renderCheckout(); focusEl($('#coName')); }
  else if(t.id === 'coBack'){ renderCart(); focusEl($('#checkout') || $('#drawerTitle')); }
  else if(t.hasAttribute('data-close')) closeModal(false);
});
/* Keep the cart in sync when another tab or page changes it. */
addEventListener('storage', e => {
  if(e.key !== CART_KEY) return;
  loadCart();
  if(isOpen('drawer') && drawerMode === 'cart'){ renderCart(); if(!$('#drawer').contains(document.activeElement)) focusEl($('#drawerTitle')); }
  else renderBadge();
});

/* ---------- Toast (visual) + polite status ---------- */
let toastT, toastClear;
function toast(msg){
  const t = $('#toast'), m = $('#toastMsg'), b = $('#toastBtn'); if(!t || !m) return;
  clearTimeout(toastT); clearTimeout(toastClear);
  t.classList.add('on'); m.textContent = msg;
  if(b){ b.tabIndex = 0; b.removeAttribute('aria-hidden'); }
  const hide = () => {
    if(t.contains(document.activeElement)){ toastT = setTimeout(hide, 1500); return; }
    t.classList.remove('on');
    if(b){ b.tabIndex = -1; b.setAttribute('aria-hidden', 'true'); }
    toastClear = setTimeout(() => { m.textContent = ''; }, 500);
  };
  toastT = setTimeout(hide, 4000);
}
on('#toastBtn', 'click', () => { const t = $('#toast'); if(t) t.classList.remove('on'); openCart(); });

/* ---------- Search (combobox + listbox inside a modal dialog) ---------- */
let hl = 0, built = false;
const sInput = $('#searchInput'), sres = $('#sres'), sList = $('#slist'), sEmpty = $('#sempty');
const visibleOpts = () => sList ? $$('[role="option"]:not([hidden])', sList) : [];
function buildSearch(){
  if(built || !sList) return;
  built = true;
  sList.innerHTML = DESIGNS.map(d => `<button type="button" role="option" tabindex="-1" id="sopt-${esc(d.id)}" data-id="${esc(d.id)}" aria-selected="false"><span class="mini" aria-hidden="true">${thumbOr(defaultCfg(d))}</span><span><b>${esc(d.name)}</b><small>${esc(d.catName || d.cat)} · ${esc(d.tag)} · ${esc(money(d.price))}</small></span></button>`).join('');
  if(!O.thumb) ensureCar().then(() => {
    $$('[role="option"] .mini', sList).forEach(el => { const d = D(el.parentNode.dataset.id); if(d) el.innerHTML = O.thumb(defaultCfg(d), true); });
  }).catch(() => {});
}
function setHl(i, scroll){
  const opts = visibleOpts();
  hl = opts.length ? Math.max(0, Math.min(i, opts.length - 1)) : 0;
  $$('[role="option"]', sList).forEach(o => { o.classList.remove('hl'); o.setAttribute('aria-selected', 'false'); });
  const cur = opts[hl];
  if(cur){
    cur.classList.add('hl'); cur.setAttribute('aria-selected', 'true');
    sInput.setAttribute('aria-activedescendant', cur.id);
    if(scroll) cur.scrollIntoView({block:'nearest'});
  } else sInput.removeAttribute('aria-activedescendant');
}
function renderSearch(){
  if(!sInput || !sList) return;
  const q = sInput.value.trim().toLowerCase();
  let n = 0;
  $$('[role="option"]', sList).forEach(o => {
    const d = D(o.dataset.id), show = !!d && (!q || [d.name, d.tag, d.cat, d.catName || ''].join(' ').toLowerCase().includes(q));
    o.hidden = !show; if(show) n++;
  });
  sInput.setAttribute('aria-expanded', n ? 'true' : 'false');
  if(sEmpty){ sEmpty.hidden = !!n; sEmpty.textContent = n ? '' : T('searchNone', {q:sInput.value.trim()}); }
  setHl(0);
  if(q) announce(n ? T.n('found', n) : T('noneFound'), 'sresCount');
}
function openSearch(){
  if(!sInput) return;
  buildSearch();
  sInput.value = ''; if(sres) sres.classList.remove('kb'); renderSearch();
  openModal($('#search'), sInput);
}
on('#openSearch', 'click', openSearch);
on(sInput, 'input', renderSearch);
on(sInput, 'keydown', e => {
  const opts = visibleOpts();
  if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    e.preventDefault(); if(!opts.length) return;
    if(sres) sres.classList.add('kb');
    setHl((hl + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length, true);
  }
  else if(e.key === 'Enter'){ e.preventDefault(); if(opts[hl]) pick(opts[hl].dataset.id); }
});
function pick(id){
  if(!D(id)) return;
  closeModal();
  if(O.onPickDesign) O.onPickDesign(id); else location.href = designURL(id);
}
on(sList, 'click', e => { const b = e.target.closest('[role="option"]'); if(b) pick(b.dataset.id); });

/* ---------- Keyboard: Esc closes the open dialog or menu; Tab stays inside an open dialog ---------- */
document.addEventListener('keydown', e => {
  if(e.key === 'Escape'){
    if(modal){ e.preventDefault(); closeModal(); }
    else if(menuOpen()){ e.preventDefault(); setMenu(false, true); }
    return;
  }
  if(e.key !== 'Tab' || !modal) return;
  const f = focusables(modal.el);
  if(!f.length){ e.preventDefault(); return; }
  const first = f[0], last = f[f.length - 1], a = document.activeElement, inside = modal.el.contains(a);
  if(e.shiftKey && (a === first || !inside)){ e.preventDefault(); focusEl(last); }
  else if(!e.shiftKey && (a === last || !inside)){ e.preventDefault(); focusEl(first); }
});

/* ---------- Header: nav ink under the current page, mobile menu ---------- */
function moveInk(){
  const a = $('#nav a[aria-current="page"]'), ink = $('#navInk');
  if(!ink) return;
  if(!a){ ink.style.width = 0; return; }
  ink.style.left = a.offsetLeft + 'px'; ink.style.width = a.offsetWidth + 'px';
}
addEventListener('resize', moveInk);
const menuBtn = $('#menuBtn'), mnav = $('#mnav');
const menuOpen = () => !!mnav && mnav.classList.contains('on');
function setMenu(open, focusBtn){
  if(!mnav || !menuBtn) return;
  mnav.classList.toggle('on', open);
  menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if(!open && focusBtn) focusEl(menuBtn);
}
on(menuBtn, 'click', () => setMenu(!menuOpen()));
document.addEventListener('click', e => { if(menuOpen() && !mnav.contains(e.target) && !menuBtn.contains(e.target)) setMenu(false); });
/* A link to the page you're already on scrolls back to the top instead of reloading (as the single-page version did). */
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href]');
  if(!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
  let u; try { u = new URL(a.href, location.href); } catch(err) { return; }
  if(u.origin !== location.origin || normPath(u.pathname) !== normPath(location.pathname) || u.hash) return;
  if(u.search && u.search !== location.search) return;
  e.preventDefault();
  window.scrollTo({top:0, behavior: reduce ? 'auto' : 'smooth'});
  setMenu(false);
  if(a.hasAttribute('data-close')) closeModal();
});

/* ---------- Design cards (home + shop): Customize / Quick add / click anywhere ---------- */
document.addEventListener('click', e => {
  const card = e.target.closest && e.target.closest('.dcard'); if(!card) return;
  const d = D(card.dataset.id); if(!d) return;
  const actEl = e.target.closest('[data-act]'), act = actEl && actEl.dataset.act;
  if(act === 'add'){ addToCart(defaultCfg(d)); return; }
  if(act === 'custom' || e.target.closest('a,button')) return; // real link / other control
  if(O.onPickDesign) O.onPickDesign(d.id); else location.href = designURL(d.id);
});

/* ---------- Category filter (pre-rendered aria-pressed buttons) ---------- */
function filters(el, onPick){
  if(!el) return;
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-c]'); if(!b) return;
    $$('button[data-c]', el).forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    onPick(b.dataset.c);
  });
}
function filterCards(sel, c){
  let n = 0;
  $$(sel).forEach(el => {
    const show = c === 'All' || el.dataset.cat === c;
    el.classList.toggle('out', !show);
    if(show){ n++; if(!reduce && el.animate) el.animate([{opacity:0, transform:'translateY(8px) scale(.98)'},{opacity:1, transform:'none'}],{duration:380, easing:'cubic-bezier(.2,.7,.2,1)'}); }
  });
  announce(T.n('shown', n, {cat: c === 'All' ? T('allDesigns') : T.cat(c)}));
  return n;
}

/* ---------- Theme ---------- */
/* The current theme comes from the visitor's choice (data-ofst) when there is one, otherwise from the luminance of the
   palette actually in use (--bg), which covers the OS setting and a host page's data-theme. Computed color-scheme is not
   used: an embedding viewer can override it, which used to leave the toggle stuck on light. */
const root = document.documentElement;
function bgIsDark(){
  const v = getComputedStyle(root).getPropertyValue('--bg').trim();
  let rgb, m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if(m){ const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]; rgb = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); }
  else { m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v); if(!m) return true; rgb = m.slice(1, 4).map(Number); }
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 128;
}
const isDark = () => { const t = root.dataset.ofst; return t === 'dark' ? true : t === 'light' ? false : bgIsDark(); };
function syncThemeBtn(){
  const b = $('#themeBtn'); if(!b) return;
  const d = isDark();
  b.classList.toggle('is-dark', d);
  b.setAttribute('aria-label', T(d ? 'themeToLight' : 'themeToDark'));
}
function setTheme(t){ if(root.dataset.ofst !== t) root.dataset.ofst = t; syncThemeBtn(); } // idempotent
syncThemeBtn();
mq('(prefers-color-scheme: light)').addEventListener('change', syncThemeBtn);
new MutationObserver(syncThemeBtn).observe(root, {attributes:true, attributeFilter:['data-theme', 'data-ofst']});
addEventListener('storage', e => { if(e.key === 'ofst-theme' && (e.newValue === 'light' || e.newValue === 'dark')) setTheme(e.newValue); });
let themePending = null; // apply() of a view transition whose update hasn't run yet
on('#themeBtn', 'click', e => {
  if(themePending) themePending(); // quick second click: finish the previous switch first
  const next = isDark() ? 'light' : 'dark';
  store.set('ofst-theme', next);
  let done = false, fallback = 0;
  const apply = () => { if(done) return; done = true; clearTimeout(fallback); if(themePending === apply) themePending = null; setTheme(next); };
  if(document.startViewTransition && !reduce && document.visibilityState === 'visible'){
    const r = e.currentTarget.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const rad = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.classList.add('theme-vt');
    let vt = null;
    try { vt = document.startViewTransition(apply); } catch(err) { vt = null; }
    if(!vt){ root.classList.remove('theme-vt'); apply(); return; }
    themePending = apply;
    // The update callback can be skipped or never scheduled (hidden or embedded documents): apply anyway.
    fallback = setTimeout(() => { if(!done){ try { vt.skipTransition(); } catch(err) {} apply(); root.classList.remove('theme-vt'); } }, 350);
    vt.ready.then(() => root.animate(
      {clipPath:[`circle(0px at ${x}px ${y}px)`, `circle(${rad}px at ${x}px ${y}px)`]},
      {duration:700, easing:'cubic-bezier(.2,.7,.2,1)', pseudoElement:'::view-transition-new(root)'}
    )).catch(() => {});
    const end = () => { apply(); root.classList.remove('theme-vt'); };
    vt.finished.then(end, end);
  } else {
    root.classList.add('theming'); apply();
    setTimeout(() => root.classList.remove('theming'), 500);
  }
});

/* ---------- Language switch (PT | EN, header + mobile menu) ----------
   The links are pre-rendered to the same page in the other language. Here they keep the query string and the #fragment, and on
   the configurator they carry the kit being designed (O.currentCfg, set by configurator.js). No automatic redirects. */
function langHref(a){
  const base = a.dataset.base || (a.dataset.base = a.getAttribute('href'));
  let q = location.search;
  if(O.currentCfg && a.getAttribute('aria-current') !== 'true'){ const c = O.currentCfg(); if(c) q = '?' + cfgQuery(c); }
  return base + q + location.hash;
}
const syncLang = () => $$('a[data-lang]').forEach(a => a.setAttribute('href', langHref(a)));
['click', 'pointerdown', 'focusin'].forEach(ev => document.addEventListener(ev, e => {
  const a = e.target.closest && e.target.closest('a[data-lang]'); if(a) a.setAttribute('href', langHref(a));
}, true));

/* ---------- Boot ---------- */
syncLang();
loadCart();
renderBadge();
moveInk();
if(document.fonts) document.fonts.ready.then(moveInk);
const view = $('main .view');
if(view && !reduce && view.animate) view.animate([{opacity:0, transform:'translateY(10px)'},{opacity:1, transform:'none'}],{duration:450, easing:'cubic-bezier(.2,.7,.2,1)'});

Object.assign(O, {
  ROOT, LANG, LANG_ROOT, T, money, cfgQuery, $, $$, esc, reduce, COLORS, DESIGNS, EXTRA, D, has, MODELS, modelName, defaultCfg, sanitizeCfg, cleanNumber, isPersonalised,
  designURL, priceOf, colourLabel, descOf, addToCart, announce, filters, filterCards
});
})();
