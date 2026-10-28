/* Designs managed from the admin "Designs" tab. The built-in designs (src/data/designs.json) always exist; the `designs` table
   (migrations/0009_designs.sql) holds designs the owner added, and overrides for built-in ones (price, name, hidden...).
   If the table cannot be read (migration not run yet) everything falls back to the built-in list, so the shop keeps working. */
import DATA from '../../src/data/designs.json';

export class DesignError extends Error { constructor(public status: number, public code: string) { super(code); } }
export interface DesignEnv { DB: D1Database }

const COLORS = DATA.colors as Record<string, unknown>;
const BUILTIN = DATA.designs as { id: string; name: string; tag: string; cat: string; price: number; c1: string; c2: string; fixed?: boolean }[];
const ID = /^[a-z0-9][a-z0-9-]{1,38}$/;
const MAX_CUSTOM = 40;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
export interface PricedDesign { id: string; name: string; price: number; c1: string; c2: string; fixed?: boolean }

interface Row { id: string; name: string | null; tag: string | null; tag_pt: string | null; cat: string | null; price: number | null; c1: string | null; c2: string | null; fixed: number | null; hidden: number; mode: string | null; ver: number; has_master: number }
const COLS = 'id, name, tag, tag_pt, cat, price, c1, c2, fixed, hidden, mode, ver, (master IS NOT NULL) AS has_master';
async function rows(env: DesignEnv): Promise<Row[]> {
  try { return ((await env.DB.prepare(`SELECT ${COLS} FROM designs ORDER BY sort, created_at`).all()).results || []) as unknown as Row[]; }
  catch (e: any) { console.error('designs table unavailable', e && e.message); return []; }
}
const isBuiltin = (id: string) => BUILTIN.some((d) => d.id === id);

/* Designs a customer can buy, with the prices the server charges (used by checkout). */
export async function pricingDesigns(env: DesignEnv): Promise<PricedDesign[]> {
  const list = await rows(env), by = new Map(list.map((r) => [r.id, r]));
  const out: PricedDesign[] = [];
  for (const d of BUILTIN) {
    const r = by.get(d.id);
    if (r && r.hidden) continue;
    out.push({ id: d.id, name: r?.name ?? d.name, price: r?.price ?? d.price, c1: r?.c1 && r.c1 in COLORS ? r.c1 : d.c1, c2: r?.c2 && r.c2 in COLORS ? r.c2 : d.c2, fixed: r && r.fixed != null ? !!r.fixed : d.fixed });
  }
  for (const r of list) {
    if (isBuiltin(r.id) || r.hidden || !r.name || !r.price || !r.c1 || !r.c2 || !r.has_master) continue;
    out.push({ id: r.id, name: r.name, price: r.price, c1: r.c1, c2: r.c2, fixed: !!r.fixed });
  }
  return out;
}

const pub = (r: Row) => ({ id: r.id, name: r.name, tag: r.tag, tagPt: r.tag_pt, cat: r.cat, price: r.price, c1: r.c1, c2: r.c2, fixed: r.fixed == null ? null : !!r.fixed, hidden: !!r.hidden, mode: r.mode, ver: r.ver, custom: !isBuiltin(r.id), hasMaster: !!r.has_master });
/* What the shop pages need: overrides of built-in designs + designs added in the admin (hidden custom designs are left out). */
export async function publicList(env: DesignEnv) {
  return { designs: (await rows(env)).filter((r) => isBuiltin(r.id) || (!r.hidden && r.has_master)).map(pub) };
}
export async function adminList(env: DesignEnv) { return { designs: (await rows(env)).map((r) => (pub(r))) }; }
export async function adminMaster(env: DesignEnv, id: string): Promise<string> {
  const r = await env.DB.prepare('SELECT master FROM designs WHERE id = ?1').bind(id).first<{ master: string | null }>();
  if (!r || !r.master) throw new DesignError(404, 'not_found');
  return r.master;
}
/* Preview picture (PNG bytes) of a design added in the admin. */
export async function designArt(env: DesignEnv, id: string, w: number): Promise<Uint8Array | null> {
  if (!ID.test(id) || (w !== 1000 && w !== 1600)) return null;
  const r = await env.DB.prepare(`SELECT art${w} AS a FROM designs WHERE id = ?1`).bind(id).first<{ a: string | null }>().catch(() => null);
  if (!r || !r.a) return null;
  const bin = atob(r.a), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const text = (v: unknown, max: number, min = 0): string => {
  if (typeof v !== 'string') throw new DesignError(400, 'invalid');
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (s.length < min || s.length > max) throw new DesignError(400, 'invalid');
  return s;
};
const colour = (v: unknown) => { if (typeof v !== 'string' || !Object.prototype.hasOwnProperty.call(COLORS, v)) throw new DesignError(400, 'invalid'); return v; };
function checkMaster(v: unknown): string {
  if (typeof v !== 'string' || v.length < 500 || v.length > 1000000 || !/<svg[\s>]/.test(v) || !v.includes('id="Artwork"') || !v.includes('id="CutContour"')) throw new DesignError(400, 'invalid');
  if (/<script|<foreignObject|<image|<use[\s>]|javascript:|\son[a-z]+\s*=|<!ENTITY|<iframe/i.test(v)) throw new DesignError(400, 'invalid'); // pure vector shapes only
  return v;
}
const checkArt = (v: unknown): string => { if (typeof v !== 'string' || v.length < 100 || v.length > 400000 || !B64.test(v) || !v.startsWith('iVBORw0KGgo')) throw new DesignError(400, 'invalid'); return v; };

/* Create or change a design. A built-in design takes the same fields (null = back to the built-in value), so the owner can also
   replace its artwork with a new master. */
export async function adminSave(env: DesignEnv, id: string, b: any) {
  if (!ID.test(id) || !b || typeof b !== 'object') throw new DesignError(400, 'invalid');
  const builtin = isBuiltin(id);
  const cur = await env.DB.prepare(`SELECT ${COLS} FROM designs WHERE id = ?1`).bind(id).first<Row>();
  const set: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  // For built-in designs null means "back to the built-in value".
  const opt = <T>(k: string, f: (v: unknown) => T) => { if (has(k)) set[k] = b[k] === null && builtin ? null : f(b[k]); };
  opt('name', (v) => text(v, 60, 1)); opt('tag', (v) => text(v, 120)); opt('tag_pt', (v) => text(v, 120));
  if (has('tagPt')) set.tag_pt = b.tagPt === null && builtin ? null : text(b.tagPt, 120);
  opt('cat', (v) => text(v, 30, 1)); opt('c1', colour); opt('c2', colour);
  opt('price', (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 999) throw new DesignError(400, 'invalid'); return n; });
  if (has('hidden')) set.hidden = b.hidden === true ? 1 : 0;
  {
    if (has('fixed')) { if (b.fixed === null && builtin) { set.fixed = null; set.mode = null; } else { set.fixed = b.fixed === true ? 1 : 0; set.mode = b.fixed === true ? 'rgb' : 'mask'; } }
    if (has('master') || has('art1000') || has('art1600')) {
      // A new master always comes with its two preview pictures.
      set.master = checkMaster(b.master); set.art1000 = checkArt(b.art1000); set.art1600 = checkArt(b.art1600);
    }
    if (!cur && !builtin) {
      for (const k of ['name', 'cat', 'price', 'c1', 'c2', 'master', 'fixed']) if (set[k] === undefined) throw new DesignError(400, 'invalid');
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM designs WHERE id NOT IN (" + BUILTIN.map(() => '?').join(',') + ')').bind(...BUILTIN.map((d) => d.id)).first<{ n: number }>();
      if ((n?.n || 0) >= MAX_CUSTOM) throw new DesignError(400, 'invalid');
    }
  }
  if (!Object.keys(set).length) throw new DesignError(400, 'invalid');
  if (set.master !== undefined && cur) set.ver = (cur.ver || 1) + 1;
  const keys = Object.keys(set), vals = keys.map((k) => set[k]);
  if (cur) {
    await env.DB.prepare(`UPDATE designs SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?${keys.length + 1}`).bind(...vals, id).run();
  } else {
    await env.DB.prepare(`INSERT INTO designs (id, ${keys.join(', ')}) VALUES (?1, ${keys.map((_, i) => `?${i + 2}`).join(', ')})`).bind(id, ...vals).run();
  }
  const row = await env.DB.prepare(`SELECT ${COLS} FROM designs WHERE id = ?1`).bind(id).first<Row>();
  return { design: row ? pub(row) : null };
}

/* Deletes a design added in the admin for good. For a built-in design (it lives in the site's files) this only removes the
   owner's changes: it is back to the original and visible. */
export async function adminDelete(env: DesignEnv, id: string) {
  if (!ID.test(id)) throw new DesignError(400, 'invalid');
  await env.DB.prepare('DELETE FROM designs WHERE id = ?1').bind(id).run();
  return { ok: true };
}
