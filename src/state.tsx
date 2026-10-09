/* App-wide state: language/kit, cart (localStorage), modal dialogs (cart drawer, search), toast and screen-reader announcements.
   Replaces core.js. The cart is shared between languages and tabs, exactly as before (same storage key). */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { getKit, langOfPath, pageOfPath, pagePath, type Cfg, type CartItem, type Kit, type Lang, type PageKey } from './lib/kit';
import { makeBackend, type Backend, type Customer } from './lib/backend';

export type ModalName = 'cart' | 'search' | null;
export type DrawerMode = 'cart' | 'checkout';
export type LiveChannel = 'live' | 'cartLive' | 'sresCount';

interface Ctx {
  lang: Lang; kit: Kit; T: Kit['T']; backend: Backend;
  /** Router path of a page in the current language (always with a trailing slash). */
  to: (key: PageKey | string, query?: string) => string;
  /** The signed-in customer (null for guests). `ready` is false until the stored session has been checked. */
  account: { user: Customer | null; ready: boolean }; setCustomer: (u: Customer | null) => void; signOutCustomer: () => Promise<void>;
  cart: CartItem[]; cartCount: number; cartReady: boolean;
  /** Adds a kit. Guests are sent to the sign-in page first (returns false); the kit is added once they have signed in. */
  addToCart: (c: Cfg) => boolean;
  /** Sends a guest to the sign-in page; afterwards they come back here with the cart open. */
  goSignIn: () => void;
  /** Called after a successful sign-in: adds the kit the guest tried to add, goes back and opens the cart. False if none. */
  finishPendingAdd: () => boolean; changeQty: (ix: number, d: number) => void; removeItem: (ix: number) => void; clearCart: () => void;
  modal: ModalName; openModal: (m: Exclude<ModalName, null>) => void; closeModal: (restoreFocus?: boolean) => void;
  drawerMode: DrawerMode; setDrawerMode: (m: DrawerMode) => void;
  toast: { msg: string; on: boolean }; hideToast: () => void;
  live: Record<LiveChannel, string>; announce: (msg: string, ch?: LiveChannel) => void;
  /** Set by the configurator so the PT | EN switch can carry the kit being designed. */
  cfgProvider: React.MutableRefObject<(() => Cfg | null) | null>;
  /** Set by the configurator: search results and cart "edit" act in place instead of navigating. */
  onPickDesign: React.MutableRefObject<((id: string) => void) | null>;
  onEditConfig: React.MutableRefObject<((c: Cfg) => void) | null>;
  /** Element to focus once the closing dialog has released the (inert) page behind it. */
  restoreRef: React.MutableRefObject<HTMLElement | null>;
}
const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

const CART_KEY = 'amig-cart';
/* A guest who tries to add a kit is sent to sign in first. What they tried to add and where they were is kept here
   (this browser only, for an hour) so it can be added and they can be brought back once signed in. cfg is null when they
   only need to sign in to check out. */
const PENDING_KEY = 'ofst-pending-add';
const PENDING_MS = 3600 * 1000;
interface PendingAdd { cfg: Cfg | null; ret: string; at: number }
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

/* The waiting "add after sign-in", or null (none, too old or not valid). Only same-site paths are ever returned to. */
function readPending(kit: Kit): PendingAdd | null {
  let p: any = null;
  try { p = JSON.parse(store.get(PENDING_KEY) || 'null'); } catch { p = null; }
  if (!p || typeof p !== 'object' || typeof p.ret !== 'string' || !/^\/(?!\/)/.test(p.ret) || !(Date.now() - +p.at < PENDING_MS)) return null;
  return { cfg: p.cfg ? kit.sanitizeCfg(p.cfg) : null, ret: p.ret, at: +p.at };
}
/** True when a guest was sent to the sign-in page from "Add to cart" or checkout (the account page shows a short notice). */
export function hasPendingAdd(kit: Kit): boolean { return !!readPending(kit); }

function loadCart(kit: Kit): CartItem[] {
  let raw: any[] = [];
  try { raw = JSON.parse(store.get(CART_KEY) || '[]'); } catch { raw = []; }
  if (!Array.isArray(raw)) raw = [];
  const cart: CartItem[] = [];
  raw.slice(0, 50).forEach((i) => {
    const c = i && kit.sanitizeCfg(i.cfg), q = i ? Math.floor(+i.qty) : 0;
    if (!c || !(q >= 1)) return;
    const k = kit.keyOf(c), hit = cart.find((x) => x.key === k);
    if (hit) hit.qty = Math.min(hit.qty + q, 99); else cart.push({ key: k, cfg: c, qty: Math.min(q, 99) });
  });
  return cart;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const here = useRef(''); here.current = pathname + search;
  const lang = langOfPath(pathname);
  const kit = getKit(lang);
  const T = kit.T;
  const backend = useMemo(() => makeBackend(kit), [kit]);
  const to = useCallback((key: PageKey | string, query = '') => pagePath(lang, key) + (query ? '?' + query : ''), [lang]);

  /* ---------- Cart ---------- */
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartReady, setCartReady] = useState(false);
  const kitRef = useRef(kit); kitRef.current = kit;
  useEffect(() => {
    setCart(loadCart(kitRef.current)); setCartReady(true);
    const onStorage = (e: StorageEvent) => { if (e.key === CART_KEY) setCart(loadCart(kitRef.current)); };
    addEventListener('storage', onStorage);
    return () => removeEventListener('storage', onStorage);
  }, []);
  const commit = useCallback((next: CartItem[]) => { setCart(next); store.set(CART_KEY, JSON.stringify(next)); }, []);
  const cartRef = useRef(cart); cartRef.current = cart;

  /* ---------- Customer account ---------- */
  const [account, setAccount] = useState<{ user: Customer | null; ready: boolean; offline?: boolean }>({ user: null, ready: false });
  const backendRef = useRef(backend); backendRef.current = backend;
  useEffect(() => {
    let live = true;
    const b = backendRef.current;
    if (!b.hasCustomerSession()) { setAccount({ user: null, ready: true }); return; }
    b.me().then((u) => live && setAccount({ user: u, ready: true }))
      // Only an expired session signs the customer out; if the shop's server can't be reached, the saved session is kept.
      .catch((e: any) => live && setAccount({ user: null, ready: true, offline: e?.code !== 'session_expired' && b.hasCustomerSession() }));
    return () => { live = false; };
  }, []);
  const setCustomer = useCallback((u: Customer | null) => setAccount({ user: u, ready: true }), []);
  const signOutCustomer = useCallback(async () => { await backendRef.current.customerSignOut(); setAccount({ user: null, ready: true }); }, []);

  /* ---------- Announcements + toast ---------- */
  const [live, setLive] = useState<Record<LiveChannel, string>>({ live: '', cartLive: '', sresCount: '' });
  const liveT = useRef<Partial<Record<LiveChannel, ReturnType<typeof setTimeout>>>>({});
  /* Clearing first makes a repeated identical message be read again. */
  const announce = useCallback((msg: string, ch: LiveChannel = 'live') => {
    setLive((l) => ({ ...l, [ch]: '' }));
    clearTimeout(liveT.current[ch]);
    liveT.current[ch] = setTimeout(() => setLive((l) => ({ ...l, [ch]: msg })), 80);
  }, []);
  const [toast, setToast] = useState({ msg: '', on: false });
  const toastT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hideToast = useCallback(() => setToast((t) => ({ ...t, on: false })), []);
  const showToast = useCallback((msg: string) => {
    clearTimeout(toastT.current);
    setToast({ msg, on: true });
    const tick = () => {
      // Never hide the toast while its button has focus.
      if (document.getElementById('toast')?.contains(document.activeElement)) { toastT.current = setTimeout(tick, 1500); return; }
      hideToast();
    };
    toastT.current = setTimeout(tick, 4000);
  }, [hideToast]);

  /* Puts one kit in the cart (no sign-in check). */
  const putInCart = useCallback((c: Cfg) => {
    const k = kitRef.current, key = k.keyOf(c), cur = cartRef.current, hit = cur.find((i) => i.key === key);
    commit(hit ? cur.map((i) => (i === hit ? { ...i, qty: Math.min(i.qty + 1, 99) } : i)) : [...cur, { key, cfg: { ...c }, qty: 1 }]);
  }, [commit]);
  const accountRef = useRef(account); accountRef.current = account;
  /* Signed in, or a saved session that is still being checked. Without a backend nobody can sign in, so nothing is blocked. */
  const signedIn = () => {
    const b = backendRef.current, a = accountRef.current;
    return !b.configured || !!a.user || ((!a.ready || !!a.offline) && b.hasCustomerSession());
  };
  /* Remember what the guest wanted, then go to the sign-in page. In the configurator the kit goes in the address too,
     so they come back to the same design. */
  const sendToSignIn = useCallback((c: Cfg | null) => {
    const k = kitRef.current;
    const ret = c && pageOfPath(pathname) === 'configurator' ? pagePath(lang, 'configurator') + '?' + k.cfgQuery(c) : here.current;
    store.set(PENDING_KEY, JSON.stringify({ cfg: c, ret, at: Date.now() }));
    navigate(pagePath(lang, 'account'));
  }, [navigate, pathname, lang]);
  const goSignIn = useCallback(() => sendToSignIn(null), [sendToSignIn]);
  const openCartNext = useRef(false);
  const finishPendingAdd = useCallback(() => {
    const p = readPending(kitRef.current);
    store.del(PENDING_KEY);
    if (!p) return false;
    if (p.cfg) putInCart(p.cfg);
    const samePage = p.ret.split(/[?#]/)[0] === pathname;
    openCartNext.current = !samePage; // opened once the page has changed (see the pathname effect below)
    navigate(p.ret);
    if (samePage) openModal('cart');
    return true;
  }, [putInCart, navigate, pathname]); // openModal (declared below) never changes

  const addToCart = useCallback((c0: Cfg) => {
    const k = kitRef.current, c = k.sanitizeCfg(c0); if (!c) return false;
    if (!signedIn()) { sendToSignIn(c); return false; }
    putInCart(c);
    showToast(k.T('addedToCart', { name: k.D(c.design)!.name }));
    const b = document.getElementById('cartCount');
    if (b) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
    return true;
  }, [putInCart, sendToSignIn, showToast]);
  const changeQty = useCallback((ix: number, d: number) => {
    const cur = cartRef.current, i = cur[ix]; if (!i) return;
    const qty = Math.min(99, i.qty + d);
    commit(qty < 1 ? cur.filter((_, n) => n !== ix) : cur.map((x, n) => (n === ix ? { ...x, qty } : x)));
  }, [commit]);
  const removeItem = useCallback((ix: number) => commit(cartRef.current.filter((_, n) => n !== ix)), [commit]);
  const clearCart = useCallback(() => commit([]), [commit]);

  /* ---------- Modals ---------- */
  const [modal, setModal] = useState<ModalName>(null);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('cart');
  const restoreRef = useRef<HTMLElement | null>(null);
  const modalRef = useRef<{ name: Exclude<ModalName, null>; opener: HTMLElement | null } | null>(null);
  const openModal = useCallback((name: Exclude<ModalName, null>) => {
    let opener = (modalRef.current ? modalRef.current.opener : document.activeElement) as HTMLElement | null;
    if (!opener || opener === document.body || opener.id === 'toastBtn' || document.getElementById(name === 'search' ? 'search' : 'drawer')?.contains(opener))
      opener = document.getElementById(name === 'search' ? 'openSearch' : 'openCart');
    modalRef.current = { name, opener };
    if (name === 'cart') setDrawerMode('cart');
    setModal(name);
  }, []);
  const closeModal = useCallback((restore = true) => {
    const m = modalRef.current; if (!m) return;
    modalRef.current = null; setModal(null);
    restoreRef.current = restore && m.opener && document.contains(m.opener) ? m.opener : null;
  }, []);
  // Navigating (a link inside a dialog, language switch) closes the dialog without stealing focus.
  // Coming back after signing in to add a kit: open the cart on the page they came from.
  useEffect(() => {
    if (modalRef.current) { modalRef.current = null; setModal(null); }
    if (openCartNext.current) { openCartNext.current = false; openModal('cart'); }
  }, [pathname]);

  const cfgProvider = useRef<(() => Cfg | null) | null>(null);
  const onPickDesign = useRef<((id: string) => void) | null>(null);
  const onEditConfig = useRef<((c: Cfg) => void) | null>(null);

  const value = useMemo<Ctx>(() => ({
    lang, kit, T, backend, to, account, setCustomer, signOutCustomer, cart, cartCount: cart.reduce((s, i) => s + i.qty, 0), cartReady, addToCart, goSignIn, finishPendingAdd, changeQty, removeItem, clearCart,
    modal, openModal, closeModal, drawerMode, setDrawerMode, toast, hideToast, live, announce, cfgProvider, onPickDesign, onEditConfig, restoreRef,
  }), [lang, kit, T, backend, to, account, setCustomer, signOutCustomer, cart, cartReady, addToCart, goSignIn, finishPendingAdd, changeQty, removeItem, clearCart, modal, openModal, closeModal, drawerMode, toast, hideToast, live, announce]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
