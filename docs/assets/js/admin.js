/* OFS/T orders admin (/admin/): sign-in, order list with print-file ("mold") downloads, status New -> Printed -> Shipped.
   Needs data.js, config.js, backend.js, core.js, car.js (O.ART) and mold-data.js first.
   Every order row is UNTRUSTED (anyone can insert an order through the public API): kit configs go through O.sanitizeCfg,
   all text is escaped, statuses and ids are checked against allowlists, and totals are re-checked against the price list. */
(() => {
'use strict';
const O = window.OFST, DATA = window.OFST_DATA, MD = window.OFST_MOLD;
if(!O || !O.$ || !DATA || !MD) return;
const {$, $$, esc, D, COLORS, T} = O;
const B = O.backend;
const hex = k => (COLORS[k] || COLORS[Object.keys(COLORS)[0]]).hex;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS = {new:T('stNew'), printed:T('stPrinted'), shipped:T('stShipped')};
const NEXT = {new:'printed', printed:'shipped', shipped:'new'};
const ACTION = {new:T('actNew'), printed:T('actPrinted'), shipped:T('actShipped')};
const euro = c => O.money(Math.round(c) / 100); // whole euros without decimals, like the shop
let UID = 0;

/* ---------- Print mold (door sticker) ----------
   Mold traced from the supplied door sticker: outer shape, badge ring cut-out and the two seam cuts (units 1000 x 364.68).
   Designs are fitted by mapping the car's door panel (876,658 271x104 in car.js coordinates) onto the mold. */
const MOLD = MD.MOLD;
function moldArt(c, u){
  const d = D(c.design), a = hex(c.c1), b = hex(c.c2);
  if(d.art === 'flame') return `<rect x="-10" y="-10" width="1020" height="385" fill="#000"/><path d="${MD.FLAME.dark}" fill="${b}"/><path d="${MD.FLAME.light}" fill="${a}"/><path d="${MD.FLAME.white}" fill="#fff"/>`;
  if(d.art === 'stealth') return `<image href="${MD.STEALTH}" x="-6" y="-6" width="1012" height="377" preserveAspectRatio="none"/>`;
  const A = O.ART && O.ART[c.design];
  return `<rect x="-10" y="-10" width="1020" height="385" fill="#18191A"/>` + (A ? `<g transform="scale(${(1000/271).toFixed(5)} ${(364.68/104).toFixed(5)}) translate(-876 -658)">${A.door(a, b, u + 'a')}</g>` : '');
}
function moldSVG(c, {u = 'm' + (++UID), cut = false, width = '', guide = false, label = ''} = {}){
  const M = MOLD;
  const cutLayer = cut ? `<g id="CutContour" fill="none" stroke="#FF00FF" stroke-width=".35"><path d="${M.outer}"/><path d="${M.ringO}"/><path d="${M.ringI}"/>
    <g clip-path="url(#${u}-oc)">${M.cuts.map(([x,y,w,h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join('')}</g></g>` : '';
  const a11y = label ? ` role="img" aria-label="${esc(label)}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${M.w} ${M.h}"${width ? ` width="${width}" height="${(width * M.h / M.w).toFixed(0)}"` : ''}${a11y}>
  <defs><mask id="${u}-mk" maskUnits="userSpaceOnUse" x="-10" y="-10" width="1020" height="385"><path d="${M.outer}" fill="#fff"/><path d="${M.ringO} ${M.ringI}" fill="#000" fill-rule="evenodd"/>${M.cuts.map(([x,y,w,h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000"/>`).join('')}</mask>
  <clipPath id="${u}-oc"><path d="${M.outer}"/></clipPath></defs>
  <g mask="url(#${u}-mk)"><g id="Artwork">${moldArt(c, u)}</g></g>${guide ? `<path d="${M.outer}" fill="none" stroke="#888" stroke-opacity=".5" stroke-width="1"/>` : ''}${cutLayer}</svg>`;
}
const safeTag = t => String(t || '').replace(/[^A-Z0-9-]/gi, '').slice(0, 12);
const fileBase = (c, tag) => `OFS-T_${safeTag(tag) ? safeTag(tag) + '_' : ''}${c.design}_${D(c.design).fixed ? 'original' : c.c1 + '-' + c.c2}_door`;
function saveFile(name, blob){
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.hidden = true; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
async function moldPNG(c, W = 6000){
  const svg = moldSVG(c, {width:W});
  const img = new Image(), src = URL.createObjectURL(new Blob([svg], {type:'image/svg+xml'}));
  try {
    img.src = src; await img.decode();
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Math.round(W * MOLD.h / MOLD.w);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    if(!blob) throw new Error('encode');
    return blob;
  } finally { URL.revokeObjectURL(src); }
}
const svgBlob = c => new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + moldSVG(c, {cut:true, width:1000})], {type:'image/svg+xml'});
async function downloadMold(c, kind, tag, btn){
  if(btn){ btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  try {
    if(kind === 'svg') saveFile(fileBase(c, tag) + '.svg', svgBlob(c));
    else { msg(T('preparing')); saveFile(fileBase(c, tag) + '.png', await moldPNG(c)); msg(T('fileReady')); }
  } catch(e) { msg(T('fileFailed')); }
  finally { if(btn){ btn.disabled = false; btn.removeAttribute('aria-busy'); } }
}

/* ---------- UI helpers ---------- */
const PANELS = ['admBoot', 'admSetup', 'admLogin', 'admLocked', 'admMain'];
function show(id, focus){
  PANELS.forEach(p => { const el = document.getElementById(p); if(el) el.hidden = p !== id; });
  if(focus){ const h = $('#' + id + ' h2'); if(h) h.focus(); }
}
function msg(t){ const m = $('#admMsg'); if(m) m.textContent = t; if(!m || m.closest('[hidden]')) O.announce(t); }

/* ---------- Orders (untrusted rows -> clean view model) ---------- */
let ORDERS = [];
const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
function cleanOrder(o){
  if(!o || typeof o !== 'object' || !UUID.test(String(o.id))) return null;
  const c = o.customer && typeof o.customer === 'object' ? o.customer : {};
  const raw = Array.isArray(o.items) ? o.items.slice(0, 50) : [];
  const items = raw.map(i => {
    const cfg = i && typeof i === 'object' && O.sanitizeCfg(i.cfg); if(!cfg) return null;
    return {cfg, qty:Math.min(99, Math.max(1, Math.floor(+i.qty) || 1)), list:Math.round(O.priceOf(cfg) * 100)};
  }).filter(Boolean);
  const total = Number.isFinite(+o.total_cents) ? Math.round(+o.total_cents) : 0;
  const listTotal = items.reduce((s, i) => s + i.list * i.qty, 0);
  return {
    id:String(o.id), ref:String(o.id).slice(-6).toUpperCase(), status:STATUS[o.status] ? o.status : 'new', created:new Date(o.created_at),
    name:str(c.name, 200), email:str(c.email, 254), street:str(c.street, 300), postcode:str(c.postcode, 20), city:str(c.city, 120), country:str(c.country, 60),
    items, dropped:raw.length - items.length, total, listTotal, pers:o.consent_personalised === true
  };
}
function renderStats(){
  const open = ORDERS.filter(o => o.status === 'new');
  const sheets = open.reduce((s, o) => s + o.items.reduce((t, i) => t + i.qty * (i.cfg.kit === 'both' ? 2 : 1), 0), 0);
  const revenue = ORDERS.reduce((s, o) => s + o.listTotal, 0);
  $('#admStats').innerHTML = [[T('sOrders'), ORDERS.length], [T('sToPrint'), open.length], [T('sSheets'), sheets], [T('sRevenue'), euro(revenue)]]
    .map(([k, v]) => `<div><span class="eyebrow">${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
}
function renderOrders(){
  renderStats();
  const host = $('#admOrders');
  if(!ORDERS.length){ host.innerHTML = `<p class="adm-empty">${esc(T('noOrders'))}</p>`; return; }
  host.innerHTML = ORDERS.map((o, oi) => {
    const items = o.items.map((it, ii) => {
      const c = it.cfg, n = it.qty * (c.kit === 'both' ? 2 : 1), d = D(c.design), forOrder = esc(T('forOrder', {name:d.name, ref:o.ref}));
      return `<div class="oitem"><div class="moldp">${moldSVG(c, {guide:true, label:T('moldPreview', {name:d.name})})}</div><div>
        <h4>${esc(d.name)} · ${esc(T.n('doorStickers', n))}</h4>
        <p>${esc(O.descOf(c))}<br>${esc(T('qtyLine', {q:it.qty, price:euro(it.list * it.qty)}))}${c.numberOn && c.number ? '<br>' + esc(T('badgeIn', {text:'\u0000', colour:COLORS[c.c1].name})).replace('\u0000', `<b>${esc(c.number)}</b>`) : ''}</p>
        <div class="btns"><button class="btn btn-primary" type="button" data-dl="png" data-o="${oi}" data-i="${ii}">${esc(T('dlPng'))}<span class="sr">${forOrder}</span></button><button class="btn btn-ghost" type="button" data-dl="svg" data-o="${oi}" data-i="${ii}">${esc(T('dlSvg'))}<span class="sr">${forOrder}</span></button></div>
      </div></div>`;
    }).join('');
    const warn = [];
    if(o.total !== o.listTotal) warn.push(T('warnTotal', {sent:euro(o.total), list:euro(o.listTotal)}));
    if(o.dropped) warn.push(T.n('warnDropped', o.dropped));
    const when = isNaN(o.created) ? '' : o.created.toLocaleString(T.locale);
    return `<article class="order" aria-labelledby="ord-${oi}"><div class="order-head"><div>
        <h3 id="ord-${oi}">${esc(o.name || T('customer'))} <span class="muted mono adm-ref">#${esc(o.ref)}</span></h3>
        <p>${esc(o.email)}<br>${esc(o.street)}, ${esc(o.postcode)} ${esc(o.city)}, ${esc(o.country)}<br>${esc(when)} · <span class="price">${euro(o.listTotal)}</span>${o.pers ? ' · ' + esc(T('persAck')) : ''}</p>
        ${warn.map(w => `<p class="err">${esc(w)}</p>`).join('')}</div>
        <div class="adm-st"><span class="status" data-s="${o.status}">${esc(STATUS[o.status])}</span>
        <button class="btn btn-ghost" type="button" data-st="${oi}">${esc(ACTION[o.status])}<span class="sr">${esc(T('orderSr', {ref:o.ref}))}</span></button></div></div>${items}</article>`;
  }).join('');
}

/* ---------- Flow ---------- */
async function loadOrders(){
  msg(T('loadingOrders'));
  try {
    ORDERS = (await B.listOrders()).map(cleanOrder).filter(Boolean);
    renderOrders();
    msg(T.n('loaded', ORDERS.length));
  } catch(e) { handleError(e); }
}
function handleError(e){
  if(e && e.code === 'session_expired'){ toLogin(e.message); return; }
  msg(e && e.message ? e.message : T('somethingWrong'));
}
function toLogin(err, focus){
  show('admLogin', focus);
  $('#admLoginErr').textContent = err || '';
}
async function enter(focus){
  let s, admin;
  try { s = await B.getSession(); if(!s){ toLogin('', focus); return; } admin = await B.isAdmin(); }
  catch(e) { toLogin(e && e.message, focus); return; } // expired session or server unreachable: back to the sign-in form with the reason
  if(!admin){ show('admLocked', focus); return; }
  show('admMain', focus);
  $('#admWho').textContent = s.user.email ? T('signedInAs', {email:s.user.email}) : T('signedIn');
  await loadOrders();
}

document.addEventListener('submit', async e => {
  if(!e.target || e.target.id !== 'admLogin') return;
  e.preventDefault();
  const email = $('#admEmail'), pass = $('#admPass'), btn = $('#admLoginBtn'), err = $('#admLoginErr');
  if(!email.value.trim() || !pass.value){ err.textContent = T('enterCreds'); (email.value.trim() ? pass : email).focus(); return; }
  btn.disabled = true; btn.setAttribute('aria-busy', 'true'); err.textContent = '';
  try {
    await B.signIn(email.value, pass.value);
    pass.value = '';
    await enter(true);
  } catch(ex) {
    err.textContent = ex && ex.message ? ex.message : T('signInFailed');
    pass.focus();
  } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
});
document.addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('button'); if(!b) return;
  if(b.hasAttribute('data-signout')){
    b.disabled = true;
    await B.signOut();
    b.disabled = false; ORDERS = []; $('#admOrders').innerHTML = ''; $('#admStats').innerHTML = '';
    toLogin(''); $('#admEmail').focus(); O.announce(T('signedOut'));
    return;
  }
  if(b.id === 'admRefresh'){ loadOrders(); return; }
  if(b.id === 'admTestPng' || b.id === 'admTestSvg'){ downloadMold(testCfg(), b.id === 'admTestPng' ? 'png' : 'svg', 'TEST', b); return; }
  if(b.dataset.dl){
    const o = ORDERS[+b.dataset.o], it = o && o.items[+b.dataset.i]; if(!it) return;
    downloadMold(it.cfg, b.dataset.dl === 'svg' ? 'svg' : 'png', o.ref, b); return;
  }
  if(b.dataset.st){
    const o = ORDERS[+b.dataset.st]; if(!o) return;
    const next = NEXT[o.status];
    b.disabled = true;
    try {
      const row = await B.setStatus(o.id, next);
      o.status = STATUS[row.status] ? row.status : next;
      renderOrders();
      const again = $(`#admOrders [data-st="${b.dataset.st}"]`); if(again) again.focus();
      msg(T('markedAs', {ref:o.ref, status:STATUS[o.status].toLowerCase()}));
    } catch(ex) { b.disabled = false; handleError(ex); }
  }
});

/* ---------- Test tool (works without a backend) ---------- */
const sel = $('#admDesign');
const testCfg = () => O.defaultCfg(D(sel && sel.value) || O.DESIGNS[0]);
function renderTest(){ const p = $('#admTestPrev'); if(p) p.innerHTML = moldSVG(testCfg(), {guide:true, label:T('moldPreview', {name:D(testCfg().design).name})}); }
if(sel){
  sel.innerHTML = O.DESIGNS.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
  sel.addEventListener('change', renderTest);
  renderTest();
}

O.mold = Object.freeze({svg:moldSVG, png:moldPNG, svgBlob, fileBase});

/* ---------- Boot ---------- */
if(!B || !B.configured) show('admSetup');
else enter(false);
})();
