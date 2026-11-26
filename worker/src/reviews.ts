/* Customer reviews the owner adds from the admin "Reviews" tab: name, 0-5 stars, comment and an optional photo. They are shown on the home page
   (above "How it works") and in the configurator (below the order summary).
   Table `reviews` (migrations/0012_reviews.sql). The photo is a small picture (the admin shrinks it to 480 px) kept in the row as a data URL, so the
   public list is one request and needs no extra image route. If the table cannot be read (migration not run yet) the public list is simply empty. */
export class ReviewError extends Error { constructor(public status: number, public code: string) { super(code); } }
export interface ReviewEnv { DB: D1Database }

export const MAX_REVIEWS = 40;
export const MAX_PHOTO_CHARS = 160_000; // base64 text of the shrunk picture (a 480 px webp is normally 15-50 KB)
const PHOTO_RE = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

interface Row { id: number; name: string; rating: number; comment: string; photo: string | null; created_at: string }
const pub = (r: Row) => ({ id: r.id, name: r.name, rating: r.rating, comment: r.comment, photo: r.photo || '', date: r.created_at });

/* GET /api/reviews and GET /api/admin/reviews: newest first. */
export async function listReviews(env: ReviewEnv) {
  try {
    const rows = ((await env.DB.prepare('SELECT id, name, rating, comment, photo, created_at FROM reviews ORDER BY id DESC LIMIT ?1').bind(MAX_REVIEWS).all()).results || []) as unknown as Row[];
    return { reviews: rows.map(pub) };
  } catch (e: any) { console.error('reviews unavailable', e && e.message); return { reviews: [] }; }
}

function clean(b: any, partial: boolean) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ReviewError(400, 'invalid');
  const out: { name?: string; rating?: number; comment?: string; photo?: string | null } = {};
  if (!partial || 'name' in b) {
    const s = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
    if (s.length < 1 || s.length > 60) throw new ReviewError(400, 'invalid');
    out.name = s;
  }
  if (!partial || 'rating' in b) {
    const n = Number(b.rating);
    if (!Number.isInteger(n) || n < 0 || n > 5) throw new ReviewError(400, 'invalid');
    out.rating = n;
  }
  if (!partial || 'comment' in b) {
    const s = typeof b.comment === 'string' ? b.comment.trim() : '';
    if (s.length < 1 || s.length > 600) throw new ReviewError(400, 'invalid');
    out.comment = s;
  }
  if ('photo' in b) {
    if (b.photo === null || b.photo === '') out.photo = null;
    else if (typeof b.photo === 'string' && b.photo.length <= MAX_PHOTO_CHARS && PHOTO_RE.test(b.photo)) out.photo = b.photo;
    else throw new ReviewError(400, 'invalid');
  }
  return out;
}

/* POST /api/admin/reviews  { name, rating 0-5, comment, photo? (data URL) } */
export async function addReview(env: ReviewEnv, b: any) {
  const v = clean(b, false);
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM reviews').first<{ n: number }>().catch(() => null))?.n ?? 0;
  if (n >= MAX_REVIEWS) throw new ReviewError(409, 'too_many');
  const r = await env.DB.prepare('INSERT INTO reviews (name, rating, comment, photo) VALUES (?1, ?2, ?3, ?4) RETURNING id, name, rating, comment, photo, created_at')
    .bind(v.name, v.rating, v.comment, v.photo ?? null).first<Row>();
  if (!r) throw new ReviewError(500, 'server');
  return pub(r);
}

/* PUT /api/admin/reviews/:id  any of { name, rating, comment, photo (data URL, or null to remove) } */
export async function saveReview(env: ReviewEnv, id: number, b: any) {
  const v = clean(b, true);
  const cur = await env.DB.prepare('SELECT id, name, rating, comment, photo, created_at FROM reviews WHERE id = ?1').bind(id).first<Row>();
  if (!cur) throw new ReviewError(404, 'not_found');
  const r = await env.DB.prepare('UPDATE reviews SET name = ?2, rating = ?3, comment = ?4, photo = ?5 WHERE id = ?1 RETURNING id, name, rating, comment, photo, created_at')
    .bind(id, v.name ?? cur.name, v.rating ?? cur.rating, v.comment ?? cur.comment, 'photo' in v ? v.photo ?? null : cur.photo).first<Row>();
  if (!r) throw new ReviewError(500, 'server');
  return pub(r);
}

/* DELETE /api/admin/reviews/:id */
export async function deleteReview(env: ReviewEnv, id: number) {
  await env.DB.prepare('DELETE FROM reviews WHERE id = ?1').bind(id).run();
  return { ok: true };
}
