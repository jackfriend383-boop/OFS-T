/* Waiting list for people outside the São Miguel pre-sale (for example Portugal mainland): they leave an email and we tell them when
   deliveries open in their area. Table `waitlist` (migrations/0013_waitlist.sql). The public endpoint never says whether an email was
   already on the list (so it can't be used to check who signed up); the admin "Waiting list" tab reads and clears the rows. */
export class WaitlistError extends Error { constructor(public status: number, public code: string) { super(code); } }
export interface WaitlistEnv { DB: D1Database }

export const MAX_WAITLIST = 20_000;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?\.[A-Za-z]{2,24}$/;
const AREAS = ['mainland', 'madeira', 'azores', 'other'] as const;
type Area = typeof AREAS[number];

interface Row { id: number; email: string; area: string; lang: string; created_at: string }
const pub = (r: Row) => ({ id: r.id, email: r.email, area: r.area, lang: r.lang, date: r.created_at });

/* POST /api/waitlist  { email, area?: mainland | madeira | azores | other, lang?: pt | en, consent: true } */
export async function joinWaitlist(env: WaitlistEnv, b: any) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new WaitlistError(400, 'invalid');
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL_RE.test(email) || email.includes('..')) throw new WaitlistError(400, 'invalid');
  if (b.consent !== true) throw new WaitlistError(400, 'consent');
  const area: Area = (AREAS as readonly string[]).includes(b.area) ? b.area : 'mainland';
  const lang = b.lang === 'en' ? 'en' : 'pt';
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM waitlist').first<{ n: number }>().catch(() => null))?.n ?? 0;
  if (n >= MAX_WAITLIST) throw new WaitlistError(503, 'full');
  await env.DB.prepare('INSERT OR IGNORE INTO waitlist (email, area, lang) VALUES (?1, ?2, ?3)').bind(email, area, lang).run();
  return { ok: true };
}

/* GET /api/admin/waitlist: newest first. */
export async function listWaitlist(env: WaitlistEnv) {
  try {
    const rows = ((await env.DB.prepare('SELECT id, email, area, lang, created_at FROM waitlist ORDER BY id DESC LIMIT 5000').all()).results || []) as unknown as Row[];
    return { entries: rows.map(pub) };
  } catch (e: any) { console.error('waitlist unavailable', e && e.message); throw new WaitlistError(404, 'not_found'); }
}

/* DELETE /api/admin/waitlist/:id */
export async function deleteWaitlist(env: WaitlistEnv, id: number) {
  await env.DB.prepare('DELETE FROM waitlist WHERE id = ?1').bind(id).run();
  return { ok: true };
}
