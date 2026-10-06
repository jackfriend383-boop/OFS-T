/* Configurator: live stage, design picker strip, Ami version/colour/finish/kit/badge options, summary and the mobile bar.
   Reads an optional starting config from the query string (?design=&c1=&c2=&finish=&kit=&number=&model=), validated against the data. */
(() => {
'use strict';
const O = window.OFST, DATA = window.OFST_DATA;
if(!O || !O.Stage || !DATA) return;
const $ = O.$, $$ = O.$$, esc = O.esc, reduce = O.reduce;
const COLORS = O.COLORS, DESIGNS = O.DESIGNS, D = O.D, EXTRA = O.EXTRA, T = O.T, money = O.money;
const host = $('#cfgCar'), strip = $('#strip');
if(!host || !strip || !DESIGNS.length) return;
const el = id => document.getElementById(id);
const on = (id, ev, fn) => { const x = el(id); if(x) x.addEventListener(ev, fn); };
const setText = (id, t) => { const x = el(id); if(x) x.textContent = t; };

/* ---------- Starting config ---------- */
function fromQuery(){
  let q; try { q = new URLSearchParams(location.search); } catch(e) { return null; }
  const d = D(q.get('design'));
  if(!d) return null;
  const num = q.has('number') ? O.cleanNumber(q.get('number')) : '';
  return O.sanitizeCfg({
    model:q.get('model'), design:d.id, c1:q.get('c1') || d.c1, c2:q.get('c2') || d.c2,
    finish:q.get('finish'), kit:q.get('kit'), number:num || 'AMI', numberOn:!!num
  });
}
let cfg = fromQuery() || O.defaultCfg(DESIGNS[0]);
const stage = new O.Stage(host, cfg);

/* ---------- Picker strip (pre-rendered) ---------- */
O.filters(el('cfgTabs'), c => O.filterCards('#strip .pcard', c));
strip.addEventListener('click', e => { const b = e.target.closest('.pcard'); if(b) pickDesign(b.dataset.id, true); });

/* ---------- Options ---------- */
/* Colour swatches: a radio group with a roving tabindex. Arrow keys move and select, Home/End jump. */
function swRow(row, slot){
  if(!row) return;
  row.addEventListener('click', e => { const b = e.target.closest('.sw'); if(b && O.has(COLORS, b.dataset.k)) update({[slot]: b.dataset.k}); });
  row.addEventListener('keydown', e => {
    const step = {ArrowRight:1, ArrowDown:1, ArrowLeft:-1, ArrowUp:-1}[e.key];
    if(step === undefined && e.key !== 'Home' && e.key !== 'End') return;
    const bs = $$('.sw', row), i = bs.indexOf(document.activeElement);
    if(i < 0) return;
    e.preventDefault(); e.stopPropagation();
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : (i + step + bs.length) % bs.length;
    if(O.has(COLORS, bs[j].dataset.k)) update({[slot]: bs[j].dataset.k});
    bs[j].focus();
  });
}
swRow(el('c1Row'), 'c1');
swRow(el('c2Row'), 'c2');
function seg(group, key){
  if(group) group.addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if(b) update({[key]: b.dataset.v}); });
}
seg(el('segModel'), 'model'); seg(el('segFinish'), 'finish'); seg(el('segKit'), 'kit');

const numInput = el('numInput'), numErr = el('numErr');
function numError(msg){
  if(!numInput) return;
  if(numErr){ numErr.textContent = msg; numErr.hidden = !msg; }
  if(msg){ numInput.setAttribute('aria-invalid', 'true'); numInput.setAttribute('aria-describedby', 'numErr'); }
  else { numInput.removeAttribute('aria-invalid'); numInput.removeAttribute('aria-describedby'); }
}
on('numToggle', 'click', () => { update({numberOn: !cfg.numberOn}); numError(''); if(cfg.numberOn && numInput) numInput.focus(); });
if(numInput) numInput.addEventListener('input', () => {
  const v = O.cleanNumber(numInput.value); numInput.value = v;
  if(v) numError('');
  update({number: v});
});

function pickDesign(id, resetColors, smooth = true){
  const d = D(id); if(!d) return;
  update(resetColors ? {design:id, c1:d.c1, c2:d.c2} : {design:id});
  const card = $(`#strip .pcard[data-id="${CSS.escape ? CSS.escape(id) : id}"]`);
  if(card && !card.classList.contains('out')){
    strip.scrollTo({left: card.offsetLeft - strip.offsetLeft - 24, behavior: reduce || !smooth ? 'auto' : 'smooth'});
  }
}
function loadConfig(c){ const v = O.sanitizeCfg(c); if(v) update(v); }
function cycle(dir){
  const vis = DESIGNS.filter(d => { const c = $(`#strip .pcard[data-id="${d.id}"]`); return c && !c.classList.contains('out'); });
  const list = vis.length ? vis : DESIGNS;
  let i = list.findIndex(d => d.id === cfg.design);
  i = (i + dir + list.length) % list.length;
  pickDesign(list[i].id, true);
}
on('prevD', 'click', () => cycle(-1));
on('nextD', 'click', () => cycle(1));
/* ← / → switch designs when nothing interactive has focus (or focus is on the stage), never with modifier keys (Alt+← is "back"). */
document.addEventListener('keydown', e => {
  if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if(e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
  const a = document.activeElement, st = el('stage');
  if(!(a === document.body || a === document.documentElement || a === el('main') || (st && st.contains(a) && !a.closest('#views')))) return;
  if(el('drawer') && el('drawer').classList.contains('on')) return;
  if(el('search') && el('search').classList.contains('on')) return;
  cycle(e.key === 'ArrowLeft' ? -1 : 1);
});
on('jumpPicker', 'click', () => {
  const p = el('picker'); if(!p) return;
  p.scrollIntoView({behavior: reduce ? 'auto' : 'smooth', block:'center'});
  const sel = $('#strip .pcard[aria-pressed="true"]:not(.out)') || $('#strip .pcard:not(.out)');
  if(sel) try { sel.focus({preventScroll:true}); } catch(err) { sel.focus(); }
});
on('btnReplay', 'click', () => stage.driveIn());
on('views', 'click', e => {
  const b = e.target.closest('button[data-v]'); if(!b) return;
  $$('#views button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
  stage.view(b.dataset.v);
});
// Swipe the car left/right on touch screens to change design.
let swipe = null;
on('stage', 'pointerdown', e => { if(e.pointerType !== 'mouse' && !e.target.closest('button')) swipe = {x:e.clientX, y:e.clientY}; });
on('stage', 'pointercancel', () => swipe = null);
on('stage', 'pointerup', e => {
  if(!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y; swipe = null;
  if(Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) cycle(dx < 0 ? 1 : -1);
});

/* Visual price tween; the final value is announced once through #sumLive (see update), not every frame. */
function tween(t, to){
  if(!t) return;
  const from = +t.dataset.v || 0; t.dataset.v = to;
  if(reduce || from === to){ t.textContent = money(to); return; }
  const t0 = performance.now();
  const f = n => { const k = Math.min(1, (n - t0) / 450); t.textContent = money(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)))); if(k < 1) requestAnimationFrame(f); };
  requestAnimationFrame(f);
}

let liveT = 0, lastSaid = '';
function sayLater(msg){
  clearTimeout(liveT);
  liveT = setTimeout(() => { if(msg !== lastSaid){ lastSaid = msg; setText('sumLive', msg); } }, 600);
}

function update(patch){
  const prev = cfg, merged = {...cfg, ...patch}, next = O.sanitizeCfg(merged);
  if(!next) return;
  // Badge text may be empty while the visitor is typing; sanitizeCfg would switch the badge off and reset it to "AMI".
  next.numberOn = !!merged.numberOn;
  if(typeof merged.number === 'string') next.number = O.cleanNumber(merged.number);
  if(!next.numberOn && !next.number) next.number = 'AMI';
  cfg = next;
  stage.set(cfg);
  const d = D(cfg.design);
  $$('#strip .pcard').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === cfg.design ? 'true' : 'false'));
  ['c1', 'c2'].forEach(s => $$(`#${s}Row .sw`).forEach(b => { const sel = b.dataset.k === cfg[s]; b.setAttribute('aria-checked', sel ? 'true' : 'false'); b.tabIndex = sel ? 0 : -1; }));
  [['segModel','model'],['segFinish','finish'],['segKit','kit']].forEach(([id,k]) => { const g = el(id); if(!g) return; $$('button[data-v]', g).forEach((b,i) => { b.setAttribute('aria-pressed', b.dataset.v === cfg[k] ? 'true' : 'false'); if(b.dataset.v === cfg[k]) g.dataset.i = i; }); });
  const tg = el('numToggle'); if(tg) tg.setAttribute('aria-checked', cfg.numberOn ? 'true' : 'false');
  if(numInput){ numInput.disabled = !cfg.numberOn; if(numInput.value !== cfg.number) numInput.value = cfg.number; }
  if(!cfg.numberOn) numError('');
  setText('c1Name', COLORS[cfg.c1].name); setText('c2Name', COLORS[cfg.c2].name);
  if(el('swWrap')) el('swWrap').hidden = !!d.fixed;
  if(el('fixedNote')) el('fixedNote').hidden = !d.fixed;
  const tones = d.art === 'flame';
  setText('c1Label', T(tones ? 'lightTone' : 'primary'));
  setText('c2Label', T(tones ? 'darkTone' : 'accent'));
  setText('optDesign', `${d.name} · ${d.catName || d.cat}`);
  setText('stName', d.name); setText('stCat', d.catName || d.cat); setText('stTag', d.tag);
  if(prev.design !== cfg.design && !reduce){ const t = el('stageTag'); if(t){ t.classList.remove('swap'); void t.offsetWidth; t.classList.add('swap'); } }
  setText('sumName', d.name); setText('mName', d.name);
  setText('sumSub', `${O.modelName(cfg.model)} · ${O.colourLabel(cfg)} · ${T(cfg.finish === 'gloss' ? 'gloss' : 'matte')}`);
  const lines = [[T('kitOneSide', {name:d.name}), money(d.price)]];
  if(cfg.kit === 'both') lines.push([T('secondSide'), '+' + money(EXTRA.secondSide)]);
  if(cfg.numberOn && cfg.number) lines.push([T('badgeText', {text:cfg.number}), '+' + money(EXTRA.badge)]);
  const sl = el('sumLines');
  if(sl){
    const old = $$('li', sl).map(li => li.textContent);
    sl.innerHTML = lines.map(([a,b]) => `<li class="${old.includes(a+b) ? '' : 'in'}"><span>${esc(a)}</span><span>${esc(b)}</span></li>`).join('');
  }
  const pers = O.isPersonalised(cfg), pn = el('persNote');
  if(pn) pn.hidden = !pers;
  const total = O.priceOf(cfg);
  tween(el('sumTotal'), total); tween(el('mTotal'), total);
  if(started) sayLater(T('cfgSay', {name:d.name, model:O.modelName(cfg.model), colours:O.colourLabel(cfg), finish:T(cfg.finish === 'gloss' ? 'glossLc' : 'matteLc'),
    sides:T(cfg.kit === 'both' ? 'bothSidesLc' : 'oneSideLc'), total:money(total)}) + (pers ? T('cfgSayPers') : ''));
}

function addCurrent(){
  if(cfg.numberOn && !cfg.number){
    numError(T('numErr'));
    if(numInput) numInput.focus();
    return;
  }
  O.addToCart(cfg);
  const bs = [el('addCart'), el('mAdd')].filter(Boolean);
  bs.forEach(b => { b.textContent = T('added'); b.classList.add('done'); });
  clearTimeout(addCurrent.t);
  addCurrent.t = setTimeout(() => bs.forEach(b => { b.textContent = T('addToCart'); b.classList.remove('done'); }), 1600);
}
on('addCart', 'click', addCurrent);
on('mAdd', 'click', addCurrent);

/* Search results, design cards and cart "edit" act in place on this page instead of navigating. */
O.onPickDesign = id => pickDesign(id, true);
O.onEditConfig = loadConfig;
/* The language switch carries the kit being designed to the other language (core.js). */
O.currentCfg = () => cfg;

/* ---------- Boot ---------- */
let started = false;
const start = O.priceOf(cfg);
[el('sumTotal'), el('mTotal')].forEach(t => { if(t){ t.dataset.v = start; t.textContent = money(start); } });
update({});
started = true;
const sel = $(`#strip .pcard[data-id="${cfg.design}"]`);
if(sel && cfg.design !== DESIGNS[0].id) requestAnimationFrame(() => { strip.scrollTo({left: sel.offsetLeft - strip.offsetLeft - 24, behavior:'auto'}); });
stage.driveIn();
})();
