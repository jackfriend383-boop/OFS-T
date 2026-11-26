/* Customer reviews the owner adds in the admin "Reviews" tab (worker/src/reviews.ts). */
export interface Review { id: number; name: string; rating: number; comment: string; photo: string; date: string }

/* The server's answer, cleaned: anything that does not look right is dropped, so the page never renders a broken review. */
export function cleanReviews(raw: unknown): Review[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as any).reviews) ? (raw as any).reviews : [];
  const out: Review[] = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const id = Number(r.id), rating = Number(r.rating), name = typeof r.name === 'string' ? r.name.trim() : '', comment = typeof r.comment === 'string' ? r.comment.trim() : '';
    if (!Number.isInteger(id) || !Number.isInteger(rating) || rating < 0 || rating > 5 || !name || !comment) continue;
    const photo = typeof r.photo === 'string' && /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(r.photo) ? r.photo : '';
    out.push({ id, name: name.slice(0, 60), rating, comment: comment.slice(0, 600), photo, date: typeof r.date === 'string' ? r.date : '' });
  }
  return out;
}

/* Shrinks a chosen photo in the browser to a small square-ish picture (at most 480 px on the long side) as a data URL, under the server's limit. */
export const MAX_PHOTO_FILE = 8 * 1024 * 1024, MAX_PHOTO_CHARS = 150_000;
export async function shrinkPhoto(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  try {
    let side = 480;
    for (let round = 0; round < 5; round++) {
      const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d'); if (!ctx) throw new Error('canvas');
      ctx.drawImage(bmp, 0, 0, w, h);
      for (let q = 0.82; q > 0.4; q -= 0.14) {
        let url = cv.toDataURL('image/webp', q);
        if (!url.startsWith('data:image/webp')) url = cv.toDataURL('image/jpeg', q);
        if (url.length <= MAX_PHOTO_CHARS) return url;
      }
      side = Math.round(side * 0.75);
    }
    throw new Error('too_big');
  } finally { bmp.close(); }
}
