/* OFS/T motion: hero intro, scroll reveals, nav ink hover, smooth FAQ open/close, cart items easing in.
   Loaded on every page after core.js. Does nothing under prefers-reduced-motion. Content is only ever hidden through
   html.js-motion, which this script adds, and only below the fold, so the page reads fine without it. */
(() => {
'use strict';
if(!window.matchMedia || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
const root = document.documentElement;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const EASE = 'cubic-bezier(.2,.7,.2,1)';
root.classList.add('js-motion');

/* ---------- Hero intro: headline lines stagger in, then the lead and the buttons rise ---------- */
const heroCopy = $('.hero-copy');
if(heroCopy){
  const h1 = $('h1', heroCopy);
  if(h1 && !$('.ln', h1)){
    const groups = [[]];
    [...h1.childNodes].forEach(n => { if(n.nodeName === 'BR') groups.push(n, []); else groups[groups.length - 1].push(n); });
    let i = 0;
    groups.forEach(g => {
      if(!Array.isArray(g) || !g.length) return;
      const s = document.createElement('span');
      s.className = 'ln'; s.style.setProperty('--i', i++);
      g[0].before(s); s.append(...g);
    });
  }
  heroCopy.classList.add('hero-intro');
  setTimeout(() => heroCopy.classList.remove('hero-intro'), 1600);
}

/* ---------- Scroll reveal (once). Only elements that start below the fold are hidden. ---------- */
const REVEAL = ['.sec-head', '.grid-cards > .dcard', '.specs-strip > div', '.steps > .step-card', '.fit', '.canvas-band',
  '.values > div', '.about-grid > div > p', '.faq details', '.legal > *', '.foot > div'].join(',');
// Skipped in a hidden document (no rendering, so no intersection updates): nothing is hidden there.
if('IntersectionObserver' in window && document.visibilityState === 'visible'){
  const vh = innerHeight || document.documentElement.clientHeight;
  const items = $$(REVEAL).filter(el => { const r = el.getBoundingClientRect(); return r.height > 0 && r.top > vh * 0.92; });
  const show = (el, i) => {
    const d = Math.min(i, 7) * 70;
    el.style.setProperty('--d', d + 'ms');
    el.classList.add('in');
    setTimeout(() => { el.classList.remove('rv', 'in'); el.style.removeProperty('--d'); }, 760 + d);
  };
  const io = new IntersectionObserver(entries => {
    entries.filter(e => e.isIntersecting).map(e => e.target)
      .sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return (ra.top - rb.top) || (ra.left - rb.left); })
      .forEach((el, i) => { io.unobserve(el); show(el, i); });
  }, {rootMargin:'0px 0px -6% 0px', threshold:0});
  items.forEach(el => { el.classList.add('rv'); io.observe(el); });
  const all = () => items.forEach(el => { io.unobserve(el); el.classList.remove('rv', 'in'); });
  addEventListener('beforeprint', all);
  // A fast jump (scrollbar drag, End key, anchor) can skip an element without it ever intersecting: reveal whatever is
  // already above the bottom of the viewport.
  let pend = items.slice(), tick = 0;
  const sweep = () => {
    tick = 0;
    pend = pend.filter(el => el.classList.contains('rv') && !el.classList.contains('in'));
    const h = innerHeight;
    pend.filter(el => el.getBoundingClientRect().top < h).forEach((el, i) => { io.unobserve(el); show(el, i); });
    if(!pend.length) removeEventListener('scroll', onScroll);
  };
  const onScroll = () => { if(!tick) tick = setTimeout(sweep, 60); };
  addEventListener('scroll', onScroll, {passive:true});
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') onScroll(); });
}

/* ---------- Header: the nav ink follows the hovered link, then slides back to the current page ---------- */
const nav = $('#nav'), ink = $('#navInk');
if(nav && ink && matchMedia('(hover: hover)').matches){
  const place = a => { ink.style.left = a.offsetLeft + 'px'; ink.style.width = a.offsetWidth + 'px'; };
  nav.addEventListener('mouseover', e => { const a = e.target.closest('a'); if(a && nav.contains(a)) place(a); });
  nav.addEventListener('mouseleave', () => { const cur = $('a[aria-current="page"]', nav); if(cur) place(cur); else ink.style.width = 0; });
}

/* ---------- FAQ: smooth open/close (the native toggle still happens; keyboard works as before) ---------- */
$$('.faq details').forEach(d => {
  const s = $('summary', d); if(!s || !d.animate) return;
  let anim = null, closing = false;
  s.addEventListener('click', e => {
    e.preventDefault();
    const from = d.getBoundingClientRect().height;
    if(anim) anim.cancel();
    let to;
    if(!d.open || closing){ closing = false; d.open = true; to = d.getBoundingClientRect().height; }
    else { closing = true; to = s.offsetHeight + (d.offsetHeight - d.clientHeight); }
    d.style.overflow = 'hidden';
    const a = anim = d.animate({height:[from + 'px', to + 'px']}, {duration:340, easing:EASE});
    // Finish on a timer as well: finish events wait for a rendering update, which a hidden document may never get.
    const end = () => { if(anim !== a) return; anim = null; if(closing){ closing = false; d.open = false; } d.style.overflow = ''; };
    a.onfinish = end; setTimeout(end, 380);
  });
});

/* ---------- Cart drawer: items ease in one after another when it opens ---------- */
const drawer = $('#drawer');
if(drawer){
  let wasOn = drawer.classList.contains('on');
  new MutationObserver(() => {
    const isOn = drawer.classList.contains('on');
    if(isOn && !wasOn) $$('#cartBody .citem').forEach((li, i) => {
      if(li.animate) li.animate([{opacity:0, transform:'translateX(28px)'}, {opacity:1, transform:'none'}],
        {duration:480, delay:110 + Math.min(i, 5) * 55, easing:EASE, fill:'backwards'});
    });
    wasOn = isOn;
  }).observe(drawer, {attributes:true, attributeFilter:['class']});
}
})();
