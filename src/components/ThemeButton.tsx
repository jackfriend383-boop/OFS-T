/* Light / dark switch, shared by the public site header and the admin dashboard. The choice is remembered in localStorage
   ('ofst-theme', read early by assets/js/theme-init.js so the page never flashes) and applied as <html data-ofst="light|dark">. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../state';

const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = { set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

/* ---------- Theme: the visitor's choice (data-ofst) or, failing that, the luminance of the palette in use (--bg) ---------- */
function bgIsDark() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  let rgb: number[], m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (m) { const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]; rgb = [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16)); }
  else { const r = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v); if (!r) return true; rgb = r.slice(1, 4).map(Number); }
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 128;
}
const isDark = () => { const t = document.documentElement.dataset.ofst; return t === 'dark' ? true : t === 'light' ? false : bgIsDark(); };

export function ThemeButton() {
  const { T } = useApp();
  const [dark, setDark] = useState(true); // matches the server render; synced below
  const pending = useRef<(() => void) | null>(null);
  const sync = useCallback(() => setDark(isDark()), []);
  useEffect(() => {
    sync();
    const root = document.documentElement;
    const mq = matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', sync);
    const mo = new MutationObserver(sync); mo.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-ofst'] });
    const onStorage = (e: StorageEvent) => { if (e.key === 'ofst-theme' && (e.newValue === 'light' || e.newValue === 'dark')) { root.dataset.ofst = e.newValue; sync(); } };
    addEventListener('storage', onStorage);
    return () => { mq.removeEventListener('change', sync); mo.disconnect(); removeEventListener('storage', onStorage); };
  }, [sync]);

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const root = document.documentElement;
    if (pending.current) pending.current(); // quick second click: finish the previous switch first
    const next = isDark() ? 'light' : 'dark';
    store.set('ofst-theme', next);
    let done = false, fallback: ReturnType<typeof setTimeout>;
    const apply = () => { if (done) return; done = true; clearTimeout(fallback); if (pending.current === apply) pending.current = null; if (root.dataset.ofst !== next) root.dataset.ofst = next; sync(); };
    const doc = document as any;
    if (doc.startViewTransition && !reduce() && document.visibilityState === 'visible') {
      const r = e.currentTarget.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const rad = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      root.classList.add('theme-vt');
      let vt: any = null;
      try { vt = doc.startViewTransition(apply); } catch { vt = null; }
      if (!vt) { root.classList.remove('theme-vt'); apply(); return; }
      pending.current = apply;
      // The update callback can be skipped or never scheduled (hidden or embedded documents): apply anyway.
      fallback = setTimeout(() => { if (!done) { try { vt.skipTransition(); } catch { /* already done */ } apply(); root.classList.remove('theme-vt'); } }, 350);
      vt.ready.then(() => root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${rad}px at ${x}px ${y}px)`] },
        { duration: 700, easing: 'cubic-bezier(.2,.7,.2,1)', pseudoElement: '::view-transition-new(root)' } as any,
      )).catch(() => {});
      const end = () => { apply(); root.classList.remove('theme-vt'); };
      vt.finished.then(end, end);
    } else {
      root.classList.add('theming'); apply();
      setTimeout(() => root.classList.remove('theming'), 500);
    }
  };
  return (
    <button type="button" className={'icon-btn theme-btn' + (dark ? ' is-dark' : '')} id="themeBtn" aria-label={T(dark ? 'themeToLight' : 'themeToDark')} onClick={toggle}>
      <svg className="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>
      <svg className="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" /></svg>
    </button>
  );
}
