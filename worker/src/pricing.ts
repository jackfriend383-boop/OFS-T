/* Server-side kit validation and pricing. Mirrors sanitizeCfg / priceOf in src/lib/kit.ts and reads the same price list
   (src/data/designs.json), so the amount charged through Stripe is always computed here and never taken from the browser. */
import DATA from '../../src/data/designs.json';

const MODELS: Record<string, string> = { qs: 'Ami Ami 2025', pop: 'Ami Pop' };
const COLORS = DATA.colors as Record<string, { name: string; hex: string }>;
const DESIGNS = DATA.designs as { id: string; name: string; price: number; c1: string; c2: string; fixed?: boolean }[];
const EXTRA = DATA.extras as { secondSide: number; badge: number };
const has = (o: object, k: unknown): boolean => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const cleanNumber = (v: unknown) => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9 .#&!-]/g, '').slice(0, 8);

export interface PricedItem {
  cfg: { model: string; design: string; c1: string; c2: string; finish: string; kit: string; numberOn: boolean; number: string };
  qty: number;
  unit_cents: number;
  name: string;
  desc: string;
}

/* One cart line from the browser -> a validated, priced line, or null when it is not a real kit. */
export function priceItem(raw: any): PricedItem | null {
  if (!raw || typeof raw !== 'object' || !raw.cfg || typeof raw.cfg !== 'object') return null;
  const c = raw.cfg;
  const d = DESIGNS.find((x) => x.id === c.design);
  const qty = Math.floor(Number(raw.qty));
  if (!d || !(qty >= 1)) return null;
  const model = has(MODELS, c.model) ? c.model : 'qs';
  const c1 = has(COLORS, c.c1) ? c.c1 : d.c1;
  const c2 = has(COLORS, c.c2) ? c.c2 : d.c2;
  const finish = c.finish === 'gloss' ? 'gloss' : 'matte';
  const kit = c.kit === 'both' ? 'both' : 'one';
  const number = typeof c.number === 'string' ? cleanNumber(c.number) : '';
  const numberOn = !!c.numberOn && !!number;
  const unit = d.price + (kit === 'both' ? EXTRA.secondSide : 0) + (numberOn ? EXTRA.badge : 0);
  const colours = d.fixed ? 'Original colours' : `${COLORS[c1].name} / ${COLORS[c2].name}`;
  const desc = `${MODELS[model]} · ${colours} · ${finish === 'gloss' ? 'Gloss' : 'Matte'} · ${kit === 'both' ? 'Both sides' : 'One side'}${numberOn ? ` · Badge "${number}"` : ''}`;
  return {
    cfg: { model, design: d.id, c1, c2, finish, kit, numberOn, number: numberOn ? number : '' },
    qty: Math.min(99, qty),
    unit_cents: Math.round(unit * 100),
    name: d.name,
    desc,
  };
}

/* True when the kit is made to the buyer's choices (badge text or changed colours): no change-of-mind returns. */
export function isPersonalised(i: PricedItem): boolean {
  const d = DESIGNS.find((x) => x.id === i.cfg.design)!;
  return i.cfg.numberOn || (!d.fixed && (i.cfg.c1 !== d.c1 || i.cfg.c2 !== d.c2));
}
