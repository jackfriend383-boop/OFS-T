/* Server-side kit validation and pricing. Mirrors sanitizeCfg / priceOf in src/lib/kit.ts and reads the same price list
   (src/data/designs.json), so the amount charged through Stripe is always computed here and never taken from the browser. */
import DATA from '../../src/data/designs.json';
import PT_JSON from '../../src/i18n/pt.json';
const PT = PT_JSON as unknown as { colors: Record<string, string>; js: Record<string, string> };

const MODELS: Record<string, string> = { qs: 'Ami 2025', pop: 'Ami Pop' };
const COLORS = DATA.colors as Record<string, { name: string; hex: string }>;
type PricedDesign = { id: string; name: string; price: number; c1: string; c2: string; fixed?: boolean };
const DESIGNS = DATA.designs as PricedDesign[];
const EXTRA = DATA.extras as { secondSide: number; badge: number };
const PIECE_PRICE = DATA.pieces as Record<'door' | 'window' | 'accent', number>;
/* Kit pieces: same rules as normPieces / piecesPrice in src/lib/kit.ts (keep the two in step).
   Full kit = design price; individual pieces are left + right pairs at fixed prices; accents only on the Pop.
   (Rim stickers, the logo centre and the coloured Citroën badges were removed: old carts that still send them are priced without.) */
const PIECES = ['full', 'door', 'window', 'accent'];
const PIECE_NAMES: Record<string, string> = { full: 'Full kit', door: 'Door stickers (pair)', window: 'Window stickers (pair)', accent: 'Front accents (pair)' };
/* Rear-window sticker shape per model (same as WIN_SHAPES in src/lib/kit.ts). */
const WIN_SHAPES: Record<string, string[]> = { qs: ['full', 'square'], pop: ['circle'] };
const WIN_NAMES: Record<string, string> = { full: 'Full window', circle: 'Circle', square: 'Square' };
const fullPieces = (model: string) => (model === 'pop' ? ['door', 'window', 'accent'] : ['door', 'window']);
function normPieces(raw: unknown, model: string, designPrice = 0): string[] {
  const list: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const set = new Set(list.filter((x): x is string => typeof x === 'string' && PIECES.includes(x)));
  if (model !== 'pop') set.delete('accent');
  const full = fullPieces(model);
  const partsCost = full.reduce((t, p) => t + PIECE_PRICE[p as 'door'], 0);
  // Every piece of the full kit becomes the full kit only when that is not dearer (same rule as kit.ts).
  if (set.has('full') || (full.every((p) => set.has(p)) && designPrice <= partsCost)) { full.forEach((p) => set.delete(p)); set.add('full'); }
  if (!set.size) set.add('full'); // older site versions send no pieces: the full kit
  return [...set].sort();
}
const piecesPrice = (pieces: string[], designPrice: number) =>
  pieces.includes('full') ? designPrice : pieces.reduce((s, p) => s + (p === 'full' ? 0 : PIECE_PRICE[p as 'door']), 0);
const has = (o: object, k: unknown): boolean => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const cleanNumber = (v: unknown) => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9 .#&!-]/g, '').slice(0, 8);

export interface PricedItem {
  cfg: { model: string; design: string; c1: string; c2: string; finish: string; kit: string; numberOn: boolean; number: string; pieces: string[]; winShape: string };
  qty: number;
  unit_cents: number;
  name: string;
  desc: string;
}

/* One cart line from the browser -> a validated, priced line, or null when it is not a real kit. */
/* `designs` = what can be bought right now (built-in list + the admin's designs table, see designs.ts pricingDesigns). */
export function priceItem(raw: any, lang: 'pt' | 'en' = 'en', designs: PricedDesign[] = DESIGNS): PricedItem | null {
  if (!raw || typeof raw !== 'object' || !raw.cfg || typeof raw.cfg !== 'object') return null;
  const c = raw.cfg;
  const d = designs.find((x) => x.id === c.design);
  const qty = Math.floor(Number(raw.qty));
  if (!d || !(qty >= 1)) return null;
  const model = has(MODELS, c.model) ? c.model : 'qs';
  const c1 = has(COLORS, c.c1) ? c.c1 : d.c1;
  const c2 = has(COLORS, c.c2) ? c.c2 : d.c2;
  const finish = c.finish === 'gloss' ? 'gloss' : 'matte';
  const kit = 'both'; // every kit covers both sides (kit size is no longer offered)
  const number = typeof c.number === 'string' ? cleanNumber(c.number) : '';
  const numberOn = !!c.numberOn && !!number && model !== 'pop'; // the custom badge is only offered on the Ami 2025
  const pieces = normPieces(c.pieces, model, d.price);
  const winShape = WIN_SHAPES[model].includes(c.winShape) ? c.winShape : WIN_SHAPES[model][0]; // Ami 2025: full / square; Ami Pop: circle
  const unit = piecesPrice(pieces, d.price) + EXTRA.secondSide + (numberOn ? EXTRA.badge : 0); // secondSide is 0: both sides included
  // The line text is stored with the order and shown in emails, on Stripe and in the order history: in the order's language.
  const W = lang === 'pt' ? PT : null;
  const cname = (k: string) => (W && has(W.colors, k) ? W.colors[k] : COLORS[k].name);
  const colours = d.fixed ? (W ? W.js.originalColours : 'Original colours') : `${cname(c1)} / ${cname(c2)}`;
  const pieceName = (p: string) => (W ? W.js['pc_' + p] : PIECE_NAMES[p]);
  const badge = W ? ` · ${W.js.badgeDesc.replace('{text}', number)}` : ` · Badge "${number}"`;
  // Window shape is named only when the kit has window stickers (same as winShapeLabel in kit.ts).
  const hasWindow = pieces.includes('full') || pieces.includes('window');
  const shapeName = hasWindow ? ` · ${W && W.js['winShape_' + winShape] ? W.js['winShape_' + winShape] : WIN_NAMES[winShape]}` : '';
  const desc = `${MODELS[model]} · ${colours} · ${PIECES.filter((p) => pieces.includes(p)).map(pieceName).join(' · ')}${shapeName}${numberOn ? badge : ''}`;
  return {
    cfg: { model, design: d.id, c1, c2, finish, kit, numberOn, number: numberOn ? number : '', pieces, winShape },
    qty: Math.min(99, qty),
    unit_cents: Math.round(unit * 100),
    name: d.name,
    desc,
  };
}

/* True when the kit is made to the buyer's own specification (custom badge text): no change-of-mind returns.
   Colours from our palette are standard options and keep the 14-day withdrawal right (same rule as kit.ts). */
export function isPersonalised(i: PricedItem): boolean {
  return !!i.cfg.numberOn;
}
