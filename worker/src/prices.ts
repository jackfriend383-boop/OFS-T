/* Prices the owner can change from the admin "Prices" tab: the price of each PAIR of pieces (door, window, Pop front accents), the custom
   badge, shipping, and the order value from which shipping is free. The price of the full kit is the design's own price (Designs tab).
   Table `site_prices` (migrations/0011_prices.sql), one row per changed price; no row = the default in src/data/designs.json. If the table
   cannot be read (migration not run yet) the defaults are used, so checkout keeps working. Amounts are euros here, cents in the table. */
import DATA from '../../src/data/designs.json';

export class PriceError extends Error { constructor(public status: number, public code: string) { super(code); } }
export interface PriceEnv { DB: D1Database }

export const KEYS = ['door', 'window', 'accent', 'badge', 'shipping', 'freeFrom'] as const;
export type PriceKey = typeof KEYS[number];
export type Prices = Record<PriceKey, number>;
const MAX: Record<PriceKey, number> = { door: 999, window: 999, accent: 999, badge: 999, shipping: 999, freeFrom: 9999 };

export const DEFAULT_PRICES: Prices = {
  door: DATA.pieces.door, window: DATA.pieces.window, accent: DATA.pieces.accent, badge: DATA.extras.badge,
  shipping: (DATA as any).shipping?.fee ?? 0, freeFrom: (DATA as any).shipping?.freeFrom ?? 0,
};

async function rows(env: PriceEnv): Promise<{ key: PriceKey; cents: number }[]> {
  try { return ((await env.DB.prepare('SELECT key, cents FROM site_prices').all()).results || []) as unknown as { key: PriceKey; cents: number }[]; }
  catch (e: any) { console.error('site_prices unavailable', e && e.message); return []; }
}

/* The price list in force right now (defaults + the owner's changes). Used by checkout and sent to the site. */
export async function loadPrices(env: PriceEnv): Promise<Prices> {
  const out = { ...DEFAULT_PRICES };
  for (const r of await rows(env)) if ((KEYS as readonly string[]).includes(r.key) && Number.isInteger(r.cents) && r.cents >= 0) out[r.key] = r.cents / 100;
  return out;
}

/* PUT /api/admin/prices  { door?: euros|null, ... }: a number sets the price, null puts it back to the default. */
export async function savePrices(env: PriceEnv, b: any): Promise<Prices> {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new PriceError(400, 'invalid');
  const stmts: D1PreparedStatement[] = [];
  for (const k of KEYS) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) continue;
    const v = b[k];
    if (v === null) { stmts.push(env.DB.prepare('DELETE FROM site_prices WHERE key = ?1').bind(k)); continue; }
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN;
    const min = k === 'shipping' || k === 'freeFrom' ? 0 : 1; // a piece or badge always has a price; shipping 0 = free, freeFrom 0 = no threshold
    if (!Number.isFinite(n) || n < min || n > MAX[k]) throw new PriceError(400, 'invalid');
    stmts.push(env.DB.prepare(
      `INSERT INTO site_prices (key, cents) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET cents = excluded.cents, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).bind(k, Math.round(n * 100)));
  }
  if (!stmts.length) throw new PriceError(400, 'invalid');
  await env.DB.batch(stmts);
  return loadPrices(env);
}

/* Shipping for an order whose items cost `itemsCents`: nothing when shipping is free or the order reaches the free-shipping threshold. */
export function shippingCents(p: Prices, itemsCents: number): number {
  const fee = Math.round(p.shipping * 100), free = Math.round(p.freeFrom * 100);
  return fee > 0 && !(free > 0 && itemsCents >= free) ? fee : 0;
}
