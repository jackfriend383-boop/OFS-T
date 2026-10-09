/* Shared data + helpers for one language: translations (T), localised designs and colours, kit configs, prices, URLs.
   Replaces the old window.OFST global (core.js + i18n.js). Pure functions, safe to run on the server. */
import DATA from '../data/designs.json';
import PT from '../i18n/pt.json';
import EN from '../i18n/en.json';

export type Lang = 'pt' | 'en';
export interface Design { id: string; name: string; tag: string; cat: string; catName: string; price: number; c1: string; c2: string; art?: string; fixed?: boolean }
export interface Cfg { model: 'qs' | 'pop'; design: string; c1: string; c2: string; finish: 'matte' | 'gloss'; kit: 'one' | 'both'; numberOn: boolean; number: string; trim: string; pieces: Piece[] }
export interface CartItem { key: string; cfg: Cfg; qty: number }

export const I18N: Record<Lang, any> = { pt: PT, en: EN };
export const CATS: string[] = DATA.cats;
export const HERO_CYCLE: string[] = DATA.heroCycle;
export const FEATURED: string[] = DATA.featured;
export const MODELS = { qs: 'Ami 2025', pop: 'Ami Pop' } as const;
/* Factory colour schemes of the car in each version (preview only: not part of the kit key, not saved with orders). First = default. */
export const TRIMS: Record<'qs' | 'pop', string[]> = { qs: ['yellow', 'purple', 'brown', 'browncolor'], pop: ['base'] };

/* ---------- Kit pieces ----------
   'full' = the whole kit at the design's price. Individual pieces are always a left + right pair (rims: a set of 4) at a fixed
   price (designs.json "pieces"). Front accents exist only on the Ami Pop. Rims are never part of the full kit.
   worker/src/pricing.ts repeats exactly this logic, so the price charged always matches the price shown. */
export type Piece = 'full' | 'door' | 'window' | 'accent' | 'rims';
export const PIECES: Piece[] = ['full', 'door', 'window', 'accent', 'rims']; // display order
export const PIECE_PRICE = DATA.pieces as Record<'door' | 'window' | 'accent' | 'rims', number>;
/* What the full kit contains for each version. */
export const fullPieces = (model: string): Piece[] => (model === 'pop' ? ['door', 'window', 'accent'] : ['door', 'window']);
/* Clean a list of piece codes (array or "door,rims"): unknown codes and Pop-only accents on the Ami 2025 are dropped,
   full replaces the pieces it contains, choosing every piece of the full kit becomes the full kit only when that is not
   dearer than the pieces (designPrice), and an empty choice means the full kit. Returned sorted and without repeats. */
export function normPieces(raw: unknown, model: string, designPrice = 0): Piece[] {
  const list: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const set = new Set(list.filter((x): x is Piece => typeof x === 'string' && (PIECES as string[]).includes(x)));
  if (model !== 'pop') set.delete('accent');
  const full = fullPieces(model);
  const partsCost = full.reduce((t, p) => t + PIECE_PRICE[p as 'door'], 0);
  if (set.has('full') || (full.every((p) => set.has(p)) && designPrice <= partsCost)) { full.forEach((p) => set.delete(p)); set.add('full'); }
  if (!set.size) set.add('full');
  return [...set].sort();
}
/* Price of the pieces alone (no extras). */
export const piecesPrice = (pieces: Piece[], designPrice: number) =>
  (pieces.includes('full') ? designPrice : pieces.reduce((s, p) => s + (p === 'full' || p === 'rims' ? 0 : PIECE_PRICE[p]), 0)) + (pieces.includes('rims') ? PIECE_PRICE.rims : 0);
/* Pieces actually in the box: full expanded to its parts (display order). */
export const includedPieces = (c: Pick<Cfg, 'model' | 'pieces'>): Exclude<Piece, 'full'>[] => {
  const ps = c.pieces || ['full'], full = ps.includes('full') ? fullPieces(c.model) : [];
  return (PIECES.filter((p) => p !== 'full' && (full.includes(p) || ps.includes(p))) as Exclude<Piece, 'full'>[]);
};

const has = (o: object, k: unknown): boolean => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const fmt = (s: string, v?: Record<string, unknown>) => (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (has(v, k) ? String(v[k]) : m)) : s);

export interface TFn {
  (k: string, v?: Record<string, unknown>): string;
  n: (k: string, n: number, v?: Record<string, unknown>) => string;
  raw: (k: string) => any;
  lang: Lang;
  locale: string;
  price: (v: number) => string;
  cat: (c: string) => string;
}

function makeT(lang: Lang): TFn {
  const L = I18N[lang], E = I18N.en;
  const T = ((k: string, v?: Record<string, unknown>) => fmt(has(L.js, k) ? L.js[k] : has(E.js, k) ? E.js[k] : k, v)) as TFn;
  T.n = (k, n, v) => T(k + (n === 1 ? '_one' : '_other'), { n, ...v });
  T.raw = (k) => (has(L.js, k) ? L.js[k] : E.js[k]);
  T.lang = lang;
  T.locale = L.intl;
  let nf0: Intl.NumberFormat | null = null, nf2: Intl.NumberFormat | null = null;
  try {
    nf0 = new Intl.NumberFormat(L.intl, { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
    nf2 = new Intl.NumberFormat(L.intl, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch { /* fall back below */ }
  /* Whole euros without decimals ("€69" / "69 €"), otherwise two decimals. */
  T.price = (v) => { v = +v || 0; const f = Number.isInteger(v) ? nf0 : nf2; return f ? f.format(v) : lang === 'en' ? '€' + v : v + ' €'; };
  T.cat = (c) => (has(L.cats, c) ? L.cats[c] : c);
  return T;
}

export interface Kit extends ReturnType<typeof build> {}

function build(lang: Lang) {
  const L = I18N[lang];
  const T = makeT(lang);
  const COLORS: Record<string, { name: string; hex: string; metal?: boolean }> = {};
  Object.entries(DATA.colors as Record<string, { name: string; hex: string; metal?: boolean }>).forEach(([k, c]) => { COLORS[k] = { ...c, name: has(L.colors, k) ? L.colors[k] : c.name }; });
  const DESIGNS: Design[] = (DATA.designs as any[]).map((d) => ({ ...d, tag: has(L.tags, d.id) ? L.tags[d.id] : d.tag, catName: T.cat(d.cat) }));
  const EXTRA = DATA.extras as { secondSide: number; badge: number };
  const D = (id: unknown): Design | undefined => DESIGNS.find((d) => d.id === id);
  const modelName = (m: unknown) => (has(MODELS, m) ? MODELS[m as keyof typeof MODELS] : MODELS.qs);
  const defaultCfg = (d: Design): Cfg => ({ model: 'qs', design: d.id, c1: d.c1, c2: d.c2, finish: 'matte', kit: 'both', numberOn: false, number: 'OFST', trim: TRIMS.qs[0], pieces: ['full'] }); // every kit covers both sides
  const cleanNumber = (v: unknown) => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9 .#&!-]/g, '').slice(0, 8);

  /* Validate a config from an untrusted source (query string, localStorage, order rows). Returns a full config or null. */
  function sanitizeCfg(c: any): Cfg | null {
    if (!c || typeof c !== 'object') return null;
    const d = D(c.design); if (!d) return null;
    const out = defaultCfg(d);
    if (has(MODELS, c.model)) out.model = c.model;
    // Car colour must belong to the chosen version; otherwise (e.g. after switching version) use that version's first.
    out.trim = TRIMS[out.model].includes(c.trim) ? c.trim : TRIMS[out.model][0];
    if (has(COLORS, c.c1)) out.c1 = c.c1;
    if (has(COLORS, c.c2)) out.c2 = c.c2;
    if (c.finish === 'matte' || c.finish === 'gloss') out.finish = c.finish;
    // Kit size is no longer offered: every kit (including older saved carts) is both sides.
    if (typeof c.number === 'string') out.number = cleanNumber(c.number);
    // The custom badge is only offered on the Ami 2025 (the Pop door has no badge plate).
    out.numberOn = !!c.numberOn && !!out.number && out.model !== 'pop';
    // Missing pieces (older carts, saved orders) = the full kit.
    out.pieces = normPieces(c.pieces, out.model, d.price);
    if (!out.numberOn && !out.number) out.number = 'OFST';
    return out;
  }
  /* Personalised = made to the buyer's own specification (no change-of-mind returns): only custom badge text. Choosing other
     colours from our own palette is a standard option, so the 14-day withdrawal right still applies (DL 24/2014 art. 17). */
  function isPersonalised(c: Cfg | null | undefined) {
    const d = c && D(c.design); if (!d) return false;
    return !!(c!.numberOn && c!.number);
  }
  const piecesOf = (c: Cfg) => normPieces(c.pieces, c.model, D(c.design)?.price ?? 0);
  const priceOf = (c: Cfg) => piecesPrice(piecesOf(c), D(c.design)!.price) + (c.kit === 'both' ? EXTRA.secondSide : 0) + (c.numberOn && c.number ? EXTRA.badge : 0);
  const keyOf = (c: Cfg) => [c.design, c.c1, c.c2, c.finish, c.kit, c.numberOn ? c.number : '', c.model || 'qs', piecesOf(c).join(',')].join('|');
  /* "Full kit · Rims" / "Door stickers (pair) · Window stickers (pair)", in display order. */
  const piecesLabel = (c: Cfg) => { const ps = piecesOf(c); return PIECES.filter((p) => ps.includes(p)).map((p) => T('pc_' + p)).join(' · '); };
  const colourLabel = (c: Cfg) => (D(c.design)!.fixed ? T('originalColours') : `${COLORS[c.c1].name} / ${COLORS[c.c2].name}`);
  const descOf = (c: Cfg) =>
    `${modelName(c.model)} · ${colourLabel(c)} · ${T(c.finish === 'gloss' ? 'gloss' : 'matte')} · ${piecesLabel(c)}` +
    `${c.numberOn && c.number ? ' · ' + T('badgeDesc', { text: c.number }) : ''}${isPersonalised(c) ? ' · ' + T('personalised') : ''}`;
  const cfgQuery = (c: Cfg) => {
    const p = new URLSearchParams({ design: c.design, c1: c.c1, c2: c.c2, finish: c.finish, kit: c.kit });
    if (c.numberOn && c.number) p.set('number', c.number);
    if (c.model && c.model !== 'qs') p.set('model', c.model);
    if (c.trim && c.trim !== TRIMS[c.model || 'qs'][0]) p.set('trim', c.trim);
    const ps = piecesOf(c); if (ps.join() !== 'full') p.set('pieces', ps.join(','));
    return p.toString();
  };
  /* Config from a query string (?design=&c1=&c2=&finish=&kit=&number=&model=&trim=&pieces=door,rims), validated against the data. */
  function cfgFromQuery(search: string): Cfg | null {
    let q: URLSearchParams; try { q = new URLSearchParams(search); } catch { return null; }
    // A link with only ?model= (from the home page version cards) starts on the first design in that version;
    // same for a link with only ?trim= (car colour).
    const d = D(q.get('design')) || (q.get('model') || q.get('trim') ? DESIGNS[0] : null); if (!d) return null;
    const num = q.has('number') ? cleanNumber(q.get('number')) : '';
    return sanitizeCfg({ model: q.get('model'), design: d.id, c1: q.get('c1') || d.c1, c2: q.get('c2') || d.c2, finish: q.get('finish'), kit: q.get('kit'), number: num || 'OFST', numberOn: !!num, trim: q.get('trim'), pieces: q.get('pieces') });
  }
  return { lang, L, T, COLORS, DESIGNS, EXTRA, D, has, modelName, defaultCfg, cleanNumber, sanitizeCfg, isPersonalised, priceOf, keyOf, piecesOf, piecesLabel, colourLabel, descOf, cfgQuery, cfgFromQuery, money: T.price };
}

const cache: Partial<Record<Lang, Kit>> = {};
export const getKit = (lang: Lang): Kit => (cache[lang] ||= build(lang));

/* ---------- Routes ---------- */
export const PAGE_KEYS = ['home', 'shop', 'configurator', 'about', 'privacy', 'terms', 'refunds', 'cookies', 'order', 'account'] as const;
export type PageKey = (typeof PAGE_KEYS)[number];
export const PAGE_PATH: Record<PageKey, string> = { home: '', shop: 'shop/', configurator: 'configurator/', about: 'about/', privacy: 'privacy/', terms: 'terms/', refunds: 'refunds/', cookies: 'cookies/', order: 'order/', account: 'account/' };
export const NAV: PageKey[] = ['home', 'shop', 'configurator', 'about'];
/* App path (without the deploy base) of a page in a language, always with a trailing slash. */
export const pagePath = (lang: Lang, key: PageKey | string) => (lang === 'en' ? '/en/' : '/') + (PAGE_PATH[key as PageKey] ?? key);
export const langOfPath = (pathname: string): Lang => (/^\/en(\/|$)/.test(pathname) ? 'en' : 'pt');
export const pageOfPath = (pathname: string): PageKey | null => {
  const p = pathname.replace(/^\/en(?=\/|$)/, '').replace(/^\/+|\/+$/g, '');
  const hit = PAGE_KEYS.find((k) => PAGE_PATH[k].replace(/\/$/, '') === p);
  return hit ?? null;
};
