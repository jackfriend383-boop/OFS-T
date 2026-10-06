/* Home: live hero car that cycles through designs. Featured cards are pre-rendered; core.js handles their clicks.
   Auto-cycling (WCAG 2.2.2): off with prefers-reduced-motion, paused while hovered, focused, off-screen or in a hidden tab,
   and stopped for good once the visitor picks a design with the dots. */
(() => {
'use strict';
const O = window.OFST, DATA = window.OFST_DATA;
if(!O || !O.Stage || !DATA || !Array.isArray(DATA.heroCycle)) return;
const $ = O.$, $$ = O.$$;
const host = $('#heroCar'), dots = $('#heroDots');
if(!host) return;

const heroCycle = DATA.heroCycle.filter(id => O.D(id));
if(!heroCycle.length) return;
let heroI = 0, paused = false, stopped = O.reduce, visible = true;
const hero = new O.Stage(host, O.defaultCfg(O.D(heroCycle[0])));
const hn = $('.hero-name'), nameEl = $('#heroName'), catEl = $('#heroCat');

function heroTo(i){
  heroI = i; const d = O.D(heroCycle[i]); if(!d) return;
  hero.set(O.defaultCfg(d));
  if(nameEl) nameEl.textContent = d.name;
  if(catEl) catEl.textContent = d.catName || d.cat;
  if(hn && !O.reduce){ hn.classList.remove('swap'); void hn.offsetWidth; hn.classList.add('swap'); }
  $$('#heroDots button').forEach((b,j) => b.setAttribute('aria-pressed', j === i ? 'true' : 'false'));
}
if(dots) dots.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if(b && heroCycle[+b.dataset.i]){ stopped = true; heroTo(+b.dataset.i); } });
const stage = host.closest('.hero-stage') || host;
stage.addEventListener('mouseenter', () => paused = true);
stage.addEventListener('mouseleave', () => paused = false);
stage.addEventListener('focusin', () => paused = true);
stage.addEventListener('focusout', () => paused = false);
if('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[es.length - 1].isIntersecting; }).observe(host);
host.style.cursor = 'pointer';
host.addEventListener('click', () => { location.href = O.designURL(heroCycle[heroI]); });
if(!stopped) setInterval(() => { if(!stopped && !paused && visible && !document.hidden) heroTo((heroI + 1) % heroCycle.length); }, 3400);

hero.driveIn();
})();
