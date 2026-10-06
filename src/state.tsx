/* App-wide state: language/kit, cart (localStorage), modal dialogs (cart drawer, search), toast and screen-reader announcements.
   Replaces core.js. The cart is shared between languages and tabs, exactly as before (same storage key). */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { getKit, langOfPath, pagePath, type Cfg, type CartItem, type Kit, type Lang, type PageKey } from './lib/kit';
import { makeBackend, type Backend } from './lib/backend';

export type ModalName = 'cart' | 'search' | null;
export type DrawerMode = 'cart' | 'checkout' | 'ok';
export type LiveChannel = 'live' | 'cartLive' | 'sresCount';

interface Ctx {
  lang: Lang; kit: Kit; T: Kit['T']; backend: Backend;
  /** Router path of a page in the current language (always with a trailing slash). */
  to: (key: PageKey | string, query?: string) => string;
  cart: CartItem[]; cartCount: number; cartReady: boolean;
  addToCart: (c: Cfg) => void; changeQty: (ix: number, d: number) => void; removeItem: (ix: number) => void; clearCart: () => void;
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
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

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
  const { pathname } = useLocation();
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

  const addToCart = useCallback((c0: Cfg) => {
    const k = kitRef.current, c = k.sanitizeCfg(c0); if (!c) return;
    const key = k.keyOf(c), cur = cartRef.current, hit = cur.find((i) => i.key === key);
    commit(hit ? cur.map((i) => (i === hit ? { ...i, qty: Math.min(i.qty + 1, 99) } : i)) : [...cur, { key, cfg: { ...c }, qty: 1 }]);
    showToast(k.T('addedToCart', { name: k.D(c.design)!.name }));
    const b = document.getElementById('cartCount');
    if (b) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
  }, [commit, showToast]);
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
  useEffect(() => { if (modalRef.current) { modalRef.current = null; setModal(null); } }, [pathname]);

  const cfgProvider = useRef<(() => Cfg | null) | null>(null);
  const onPickDesign = useRef<((id: string) => void) | null>(null);
  const onEditConfig = useRef<((c: Cfg) => void) | null>(null);

  const value = useMemo<Ctx>(() => ({
    lang, kit, T, backend, to, cart, cartCount: cart.reduce((s, i) => s + i.qty, 0), cartReady, addToCart, changeQty, removeItem, clearCart,
    modal, openModal, closeModal, drawerMode, setDrawerMode, toast, hideToast, live, announce, cfgProvider, onPickDesign, onEditConfig, restoreRef,
  }), [lang, kit, T, backend, to, cart, cartReady, addToCart, changeQty, removeItem, clearCart, modal, openModal, closeModal, drawerMode, toast, hideToast, live, announce]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
