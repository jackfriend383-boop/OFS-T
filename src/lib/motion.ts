/* OFS/T motion (ported from motion.js): hero intro, scroll reveals, smooth FAQ open/close.
   Does nothing under prefers-reduced-motion. Content is only ever hidden through html.js-motion, which this adds, and only
   below the fold, so the page reads fine without it (and before the scripts load). */
import { useEffect } from 'react';

const EASE = 'cubic-bezier(.2,.7,.2,1)';
const $ = (s: string, r: ParentNode = document) => r.querySelector(s) as HTMLElement | null;
const $$ = (s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as HTMLElement[];
const REVEAL = ['.sec-head', '.grid-cards > .dcard', '.specs-strip > div', '.steps > .step-card', '.fit', '.canvas-band',
  '.values > div', '.about-grid > div > p', '.faq details', '.legal > *', '.foot > div'].join(',');

export function useReveal(routeKey: string) {
  useEffect(() => {
    if (typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.documentElement.classList.add('js-motion');
    const cleanups: Array<() => void> = [];

    /* Card spotlight: the pointer position feeds two CSS variables (no React state, no re-render). Fine pointers only. */
    if (matchMedia('(hover: hover)').matches) {
      const onMove = (e: PointerEvent) => {
        const card = (e.target as HTMLElement).closest?.('.dcard') as HTMLElement | null; if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', e.clientX - r.left + 'px'); card.style.setProperty('--my', e.clientY - r.top + 'px');
      };
      document.addEventListener('pointermove', onMove, { passive: true });
      cleanups.push(() => document.removeEventListener('pointermove', onMove));
    }

    /* Hero intro: headline lines stagger in, then the lead and the buttons rise. */
    const heroCopy = $('.hero-copy');
    if (heroCopy) {
      heroCopy.classList.add('hero-intro');
      const t = setTimeout(() => heroCopy.classList.remove('hero-intro'), 1600);
      cleanups.push(() => clearTimeout(t));
    }

    /* Scroll reveal (once). Only elements that start below the fold are hidden. A hidden document gets no intersection
       updates, so nothing is hidden there. */
    if ('IntersectionObserver' in window && document.visibilityState === 'visible') {
      const vh = innerHeight || document.documentElement.clientHeight;
      const items = $$(REVEAL).filter((el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.top > vh * 0.92; });
      const show = (el: HTMLElement, i: number) => {
        const d = Math.min(i, 7) * 70;
        el.style.setProperty('--d', d + 'ms');
        el.classList.add('in');
        setTimeout(() => { el.classList.remove('rv', 'in'); el.style.removeProperty('--d'); }, 760 + d);
      };
      const io = new IntersectionObserver((entries) => {
        entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement)
          .sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return (ra.top - rb.top) || (ra.left - rb.left); })
          .forEach((el, i) => { io.unobserve(el); show(el, i); });
      }, { rootMargin: '0px 0px -6% 0px', threshold: 0 });
      items.forEach((el) => { el.classList.add('rv'); io.observe(el); });
      const all = () => items.forEach((el) => { io.unobserve(el); el.classList.remove('rv', 'in'); });
      addEventListener('beforeprint', all);
      // A fast jump (scrollbar drag, End key, anchor) can skip an element without it ever intersecting: reveal whatever is
      // already above the bottom of the viewport.
      let pend = items.slice(), tick: ReturnType<typeof setTimeout> | 0 = 0;
      const sweep = () => {
        tick = 0;
        pend = pend.filter((el) => el.classList.contains('rv') && !el.classList.contains('in'));
        const h = innerHeight;
        pend.filter((el) => el.getBoundingClientRect().top < h).forEach((el, i) => { io.unobserve(el); show(el, i); });
        if (!pend.length) removeEventListener('scroll', onScroll);
      };
      const onScroll = () => { if (!tick) tick = setTimeout(sweep, 60); };
      const onVis = () => { if (document.visibilityState === 'visible') onScroll(); };
      addEventListener('scroll', onScroll, { passive: true });
      document.addEventListener('visibilitychange', onVis);
      cleanups.push(() => {
        io.disconnect(); all(); removeEventListener('beforeprint', all); removeEventListener('scroll', onScroll);
        document.removeEventListener('visibilitychange', onVis); if (tick) clearTimeout(tick);
      });
    }
    return () => cleanups.forEach((f) => f());
  }, [routeKey]);
}

/* FAQ: smooth open/close (the native toggle still happens; keyboard works as before). */
export function useFaq(ref: React.RefObject<HTMLElement | null>, routeKey: string) {
  useEffect(() => {
    const root = ref.current; if (!root || typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const handlers: Array<[HTMLElement, (e: Event) => void]> = [];
    $$('.faq details', root).forEach((d) => {
      const s = $('summary', d) as HTMLElement | null; if (!s || !d.animate) return;
      let anim: Animation | null = null, closing = false;
      const onClick = (e: Event) => {
        e.preventDefault();
        const from = d.getBoundingClientRect().height;
        if (anim) anim.cancel();
        let to: number;
        const det = d as HTMLDetailsElement;
        if (!det.open || closing) { closing = false; det.open = true; to = d.getBoundingClientRect().height; }
        else { closing = true; to = s.offsetHeight + (d.offsetHeight - d.clientHeight); }
        d.style.overflow = 'hidden';
        const a = anim = d.animate({ height: [from + 'px', to + 'px'] }, { duration: 340, easing: EASE });
        // Finish on a timer as well: finish events wait for a rendering update, which a hidden document may never get.
        const end = () => { if (anim !== a) return; anim = null; if (closing) { closing = false; det.open = false; } d.style.overflow = ''; };
        a.onfinish = end; setTimeout(end, 380);
      };
      s.addEventListener('click', onClick); handlers.push([s, onClick]);
    });
    return () => handlers.forEach(([el, fn]) => el.removeEventListener('click', fn));
  }, [ref, routeKey]);
}

/* Cart items ease in one after another when the drawer opens. */
export function easeInCartItems() {
  if (typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  $$('#cartBody .citem').forEach((li, i) => {
    if (li.animate) li.animate([{ opacity: 0, transform: 'translateX(28px)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 110 + Math.min(i, 5) * 55, easing: EASE, fill: 'backwards' });
  });
}
