/* Page shell: header (nav ink, theme, language, search, cart, mobile menu), footer, and the cart / search / toast overlays. */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useApp } from '../state';
import { I18N, NAV, pageOfPath, pagePath, type Lang } from '../lib/kit';
import { Html, bizValues, dec } from './Html';
import { CartDrawer } from './Cart';
import { SearchDialog } from './Search';
import { useReveal } from '../lib/motion';

const BASE = import.meta.env.BASE_URL;
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

function ThemeButton() {
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

/* PT | EN: the same page in the other language. Keeps the query string and #fragment; on the configurator it carries the kit
   being designed. No automatic redirects: the language is chosen only by the URL. */
function LangSwitch({ cls }: { cls: 'lang' | 'mlang' }) {
  const { lang, kit, cfgProvider } = useApp();
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
  const page = pageOfPath(pathname);
  const target = (l: Lang) => {
    const path = page ? pagePath(l, page) : pagePath(l, 'home');
    let q = search;
    const c = cfgProvider.current && cfgProvider.current();
    if (c && l !== lang) q = '?' + kit.cfgQuery(c);
    return path + (page ? q + hash : '');
  };
  const items = (['pt', 'en'] as Lang[]).map((l) => ({ l, short: I18N[l].short as string, label: I18N[l].label as string, hreflang: I18N[l].hreflang as string, cur: l === lang }));
  return (
    <div className={cls} role="group" aria-label={kit.L.ui.t_lang_label}>
      {items.map((it, i) => (
        <Fragment key={it.l}>
          {i > 0 && cls === 'lang' && <span className="sep" aria-hidden="true">|</span>}
          <a href={BASE.replace(/\/$/, '') + target(it.l)} hrefLang={it.hreflang} lang={it.hreflang} data-lang={it.l} aria-current={it.cur ? 'true' : undefined}
            onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(target(it.l)); }}>
            {it.short}<span className="sr"> {it.label}</span>
          </a>
        </Fragment>
      ))}
    </div>
  );
}

function Header() {
  const { T, kit, to, cartCount, openModal, modal } = useApp();
  const ui = kit.L.ui;
  const { pathname } = useLocation();
  const page = pageOfPath(pathname);
  const navRef = useRef<HTMLElement>(null);
  const [ink, setInk] = useState({ left: 0, width: 0 });
  const [menu, setMenu] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const mnav = useRef<HTMLElement>(null);

  const place = useCallback((a: HTMLElement | null) => setInk(a ? { left: a.offsetLeft, width: a.offsetWidth } : { left: 0, width: 0 }), []);
  const placeCurrent = useCallback(() => place(navRef.current?.querySelector('a[aria-current="page"]') ?? null), [place]);
  useLayoutEffect(placeCurrent, [placeCurrent, pathname, kit]);
  useEffect(() => {
    addEventListener('resize', placeCurrent);
    document.fonts?.ready.then(placeCurrent);
    return () => removeEventListener('resize', placeCurrent);
  }, [placeCurrent]);
  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => { if (!mnav.current?.contains(e.target as Node) && !menuBtn.current?.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !modal) { e.preventDefault(); setMenu(false); menuBtn.current?.focus(); } };
    document.addEventListener('click', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onDown); document.removeEventListener('keydown', onKey); };
  }, [menu, modal]);
  useEffect(() => { if (modal) setMenu(false); }, [modal]);

  const hoverable = () => typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;
  const links = NAV.map((k) => ({ k, href: to(k), label: kit.L.nav[k], cur: page === k }));
  const cartLabel = cartCount ? T.n('openCart', cartCount) : T('openCartEmpty');
  return (
    <>
      <header className="top">
        <Link to={to('home')} className="brand" aria-label={ui.t_home_aria}><img src={BASE + 'assets/img/OFST-icon-white.svg'} alt="" width="34" height="34" /><span>OFS/T</span></Link>
        <nav className="nav" id="nav" aria-label={ui.t_nav_main} ref={navRef}
          onMouseOver={(e) => { const a = (e.target as HTMLElement).closest('a'); if (hoverable() && a && navRef.current?.contains(a)) place(a); }}
          onMouseLeave={() => { if (hoverable()) placeCurrent(); }}>
          {links.map((l) => <Link key={l.k} to={l.href} data-r={l.k} aria-current={l.cur ? 'page' : undefined}>{l.label}</Link>)}
          <span className="nav-ink" id="navInk" style={{ left: ink.left, width: ink.width }} />
        </nav>
        <div className="tools">
          <button type="button" className="icon-btn" id="openSearch" aria-label={ui.t_search} aria-haspopup="dialog" onClick={() => openModal('search')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg></button>
          <LangSwitch cls="lang" />
          <ThemeButton />
          <button type="button" className="icon-btn" id="openCart" aria-label={cartLabel} aria-haspopup="dialog" onClick={() => openModal('cart')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M3 4h2.2l2.3 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L20.6 8H6.1" /><circle cx="9.5" cy="20" r="1.2" /><circle cx="17" cy="20" r="1.2" /></svg><span className="badge" id="cartCount" aria-hidden="true">{cartCount}</span></button>
          <button type="button" className="icon-btn menu-btn" id="menuBtn" ref={menuBtn} aria-label={ui.t_menu} aria-expanded={menu} aria-controls="mnav" onClick={() => setMenu((m) => !m)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16" /></svg></button>
        </div>
      </header>
      <nav className={'mnav' + (menu ? ' on' : '')} id="mnav" ref={mnav} aria-label={ui.t_nav_mobile}>
        {links.map((l) => <Link key={l.k} to={l.href} data-r={l.k} aria-current={l.cur ? 'page' : undefined}>{l.label}</Link>)}
        <LangSwitch cls="mlang" />
      </nav>
    </>
  );
}

function Footer() {
  const { kit, to } = useApp();
  const L = kit.L, ui = L.ui;
  const biz = bizValues(L.placeholders || {});
  const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (m, k) => biz[k] ?? m);
  return (
    <footer className="foot">
      <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
        <Link to={to('home')} className="brand" aria-label={ui.t_home_aria}><img src={BASE + 'assets/img/OFST-icon-white.svg'} alt="" width="34" height="34" /><span>OFS/T</span></Link>
        <span style={{ maxWidth: '40ch' }}>{ui.t_foot_tag}</span>
        <address style={{ fontStyle: 'normal', fontSize: '12.5px', lineHeight: 1.55, maxWidth: '44ch' }}>
          {fill(ui.t_foot_trading)}<br />{biz.biz_street}, {biz.biz_postcode} {biz.biz_city}, {biz.biz_country}<br />{ui.t_email}: {biz.biz_email}
        </address>
      </div>
      <div><h2>{ui.t_foot_shop}</h2><Link to={to('shop')}>{ui.t_all_designs}</Link><Link to={to('configurator')}>{ui.t_configurator}</Link></div>
      <div><h2>{ui.t_help}</h2><Link to={to('about')}>{dec(ui.t_fitting)}</Link><Link to={to('about') + '#faq'}>{ui.t_faq}</Link></div>
      <div>
        <h2>{ui.t_legal}</h2>
        <Link to={to('privacy')}>{ui.t_privacy}</Link><Link to={to('terms')}>{ui.t_terms}</Link><Link to={to('refunds')}>{dec(ui.t_refunds)}</Link><Link to={to('cookies')}>{ui.t_cookies}</Link>
        <a href="https://www.livroreclamacoes.pt" rel="noopener">Livro de Reclamações</a>
        <Html as="span" html={ui.t_odr} style={{ display: 'block', marginTop: 8, fontSize: 12, maxWidth: '30ch' }} />
      </div>
    </footer>
  );
}

/* ---------- Focus handling for the open dialog: focus in, Tab trap, Esc, inert background ---------- */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export const focusables = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.getClientRects().length && getComputedStyle(x).visibility !== 'hidden');

function ModalManager({ shell }: { shell: React.RefObject<HTMLDivElement | null> }) {
  const { modal, closeModal, restoreRef } = useApp();
  useEffect(() => {
    const sh = shell.current; if (!sh) return;
    if (!modal && restoreRef.current) {
      // The page is no longer inert: give focus back to whatever opened the dialog.
      const r = restoreRef.current; restoreRef.current = null;
      requestAnimationFrame(() => { try { r.focus({ preventScroll: true }); } catch { r.focus(); } });
    }
    const el = modal ? document.getElementById(modal === 'search' ? 'search' : 'drawer') : null;
    if (modal && el) {
      sh.setAttribute('inert', '');
      const target = (modal === 'search' ? document.getElementById('searchInput') : document.getElementById('closeCart')) || focusables(el)[0] || el;
      requestAnimationFrame(() => { try { target.focus({ preventScroll: true }); } catch { target.focus(); } });
    } else sh.removeAttribute('inert');
    return () => sh.removeAttribute('inert');
  }, [modal, shell, restoreRef]);
  useEffect(() => {
    if (!modal) return;
    const el = document.getElementById(modal === 'search' ? 'search' : 'drawer')!;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables(el);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1], a = document.activeElement as HTMLElement, inside = el.contains(a);
      if (e.shiftKey && (a === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (a === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal, closeModal]);
  return null;
}

function Overlays() {
  const { modal, closeModal, toast, hideToast, openModal, live, T, kit } = useApp();
  return (
    <>
      <div className={'scrim' + (modal ? ' on' : '')} id="scrim" aria-hidden="true" onClick={() => closeModal()} />
      <CartDrawer />
      <SearchDialog />
      <div className={'toast' + (toast.on ? ' on' : '')} id="toast">
        <span id="toastMsg" role="status" aria-live="polite">{toast.msg}</span>
        <button type="button" id="toastBtn" tabIndex={toast.on ? 0 : -1} aria-hidden={toast.on ? undefined : true} onClick={() => { hideToast(); openModal('cart'); }}>{kit.L.ui.t_view_cart}</button>
      </div>
      <div className="sr" id="live" role="status" aria-live="polite">{live.live}</div>
    </>
  );
}

/* Scroll to the top on a new page (or to #fragment); a link to the page you're already on scrolls back to the top. */
function ScrollManager() {
  const { pathname, hash, key } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; if (!hash) return; }
    if (hash) { const el = document.getElementById(decodeURIComponent(hash.slice(1))); if (el) { el.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth' }); return; } }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname, hash, key]);
  return null;
}

export function Layout({ children }: { children: ReactNode }) {
  const { kit, lang } = useApp();
  const shell = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useEffect(() => { document.documentElement.lang = kit.L.hreflang; }, [kit]);
  useReveal(pathname + lang);
  return (
    <>
      <div className="shell" ref={shell}>
        <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); const m = document.getElementById('main'); m?.focus(); m?.scrollIntoView(); }}>{kit.L.ui.t_skip}</a>
        <Header />
        <main id="main" tabIndex={-1}>{children}</main>
        <Footer />
      </div>
      <Overlays />
      <ModalManager shell={shell} />
      <ScrollManager />
    </>
  );
}
