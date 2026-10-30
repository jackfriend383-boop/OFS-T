/* Site settings edited from the admin "Edits" tab. First feature: background pictures (home page + configurator, light + dark theme).
   Pictures live in D1 as base64 (the project has no R2 bucket), table `site_settings` (migrations/0010_site_settings.sql).
   A slot without a row uses the site's own default picture. If the table cannot be read (migration not run yet) the public list is
   simply empty, so the site keeps working. Every value is validated again here: the admin page is not trusted. */
export class SettingsError extends Error { constructor(public status: number, public code: string) { super(code); } }
export interface SettingsEnv { DB: D1Database }

export const SLOTS = ['homeLight', 'homeDark', 'confLight', 'confDark'] as const;
export type Slot = typeof SLOTS[number];
export const isSlot = (s: string): s is Slot => (SLOTS as readonly string[]).includes(s);
const FITS = ['cover', 'contain', 'stretch'];
export const MAX_IMAGE_BYTES = 1_500_000; // after the browser shrank it (2400 px wide webp/jpeg is normally 150-700 KB)

interface Row { slot: Slot; fit: string; zoom: number; pos_x: number; pos_y: number; ver: number }

/* The CSS the public site applies: the same rule the admin preview box uses (src/lib/siteSettings.ts, bgCss). */
function cssSize(fit: string, zoom: number): string {
  if (fit === 'contain') return 'contain';
  if (fit === 'stretch') return '100% 100%';
  return zoom > 100 ? `${zoom}% auto` : 'cover';
}

export function publicSlots(rows: Row[], origin: string) {
  const slots: Record<string, unknown> = {};
  for (const r of rows) {
    slots[r.slot] = {
      url: `${origin}/api/site-image/${r.slot}?v=${r.ver}`,
      size: cssSize(r.fit, r.zoom), pos: `${r.pos_x}% ${r.pos_y}%`,
      fit: r.fit, zoom: r.zoom, x: r.pos_x, y: r.pos_y, ver: r.ver,
    };
  }
  return { slots };
}

/* GET /api/site-settings */
export async function publicSettings(env: SettingsEnv, origin: string) {
  try {
    const rows = ((await env.DB.prepare('SELECT slot, fit, zoom, pos_x, pos_y, ver FROM site_settings').all()).results || []) as unknown as Row[];
    return publicSlots(rows, origin);
  } catch (e: any) { console.error('site_settings unavailable', e && e.message); return { slots: {} }; }
}

/* GET /api/site-image/:slot: the picture's bytes. */
export async function slotImage(env: SettingsEnv, slot: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!isSlot(slot)) return null;
  const r = await env.DB.prepare('SELECT mime, data FROM site_settings WHERE slot = ?1').bind(slot).first<{ mime: string; data: string }>().catch(() => null);
  if (!r) return null;
  const bin = atob(r.data), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { bytes: out, mime: r.mime };
}

function sniff(b: Uint8Array): string | null {
  const at = (i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b.length > 12 && at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && at(1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  return null;
}
function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/* PUT /api/admin/site-settings/:slot/image: raw image bytes (Content-Type image/webp|jpeg|png). Settings of an existing slot are kept. */
export async function putImage(req: Request, env: SettingsEnv, slot: string) {
  if (!isSlot(slot)) throw new SettingsError(404, 'not_found');
  const type = (req.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!['image/webp', 'image/jpeg', 'image/png'].includes(type)) throw new SettingsError(415, 'unsupported_media_type');
  if (Number(req.headers.get('Content-Length') || 0) > MAX_IMAGE_BYTES) throw new SettingsError(413, 'too_large');
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length < 100 || bytes.length > MAX_IMAGE_BYTES) throw new SettingsError(bytes.length < 100 ? 400 : 413, bytes.length < 100 ? 'invalid' : 'too_large');
  const real = sniff(bytes);
  if (!real || real !== type) throw new SettingsError(400, 'invalid'); // the bytes must really be the declared image type
  await env.DB.prepare(
    // ver starts from the clock (not 1) so a slot that was reset and filled again never reuses an old, cached picture URL.
    `INSERT INTO site_settings (slot, mime, data, ver) VALUES (?1, ?2, ?3, CAST(strftime('%s', 'now') AS INTEGER))
     ON CONFLICT(slot) DO UPDATE SET mime = excluded.mime, data = excluded.data, ver = max(ver + 1, CAST(strftime('%s', 'now') AS INTEGER)), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).bind(slot, real, toBase64(bytes)).run();
  return slotState(env, slot);
}

/* PUT /api/admin/site-settings/:slot  {fit, zoom, posX, posY} */
export async function putSettings(env: SettingsEnv, slot: string, b: any) {
  if (!isSlot(slot)) throw new SettingsError(404, 'not_found');
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new SettingsError(400, 'invalid');
  const int = (v: unknown, lo: number, hi: number) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw new SettingsError(400, 'invalid'); return Math.round(n); };
  if (typeof b.fit !== 'string' || !FITS.includes(b.fit)) throw new SettingsError(400, 'invalid');
  const zoom = int(b.zoom, 100, 250), x = int(b.posX, 0, 100), y = int(b.posY, 0, 100);
  const r = await env.DB.prepare(
    `UPDATE site_settings SET fit = ?2, zoom = ?3, pos_x = ?4, pos_y = ?5, ver = ver + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slot = ?1`,
  ).bind(slot, b.fit, zoom, x, y).run();
  if (!r.meta || !r.meta.changes) throw new SettingsError(409, 'no_image'); // settings only apply to a custom picture
  return slotState(env, slot);
}

/* DELETE /api/admin/site-settings/:slot: back to the site's default picture. */
export async function deleteSlot(env: SettingsEnv, slot: string) {
  if (!isSlot(slot)) throw new SettingsError(404, 'not_found');
  await env.DB.prepare('DELETE FROM site_settings WHERE slot = ?1').bind(slot).run();
  return { ok: true };
}

async function slotState(env: SettingsEnv, slot: Slot) {
  const r = await env.DB.prepare('SELECT slot, fit, zoom, pos_x, pos_y, ver FROM site_settings WHERE slot = ?1').bind(slot).first<Row>();
  return { slot, ver: r ? r.ver : 0 };
}
