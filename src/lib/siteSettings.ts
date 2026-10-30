/* Runtime site settings (admin "Edits" tab): background pictures for the home page and the configurator, one per slot and theme.
   The public site reads them once on start (client only, never during the server render, failures ignored silently) and sets
   CSS custom properties on <html>; site.css falls back to its own default pictures when a variable is missing:
     --bg-home-light, --bg-home-dark, --bg-conf-light, --bg-conf-dark                    url("...")
     --bg-<page>-<theme>-size / --bg-<page>-<theme>-pos                                  per slot (page = home|conf, theme = light|dark)
     --bg-home-size, --bg-home-pos, --bg-conf-size, --bg-conf-pos                        the slot of the theme that is active right now
   A slot without a custom picture gets none of its variables. The last answer is cached in localStorage so the next visit paints
   the right picture straight away. This file also holds the helpers the admin tab uses (same CSS rule for the live preview). */
import SITE from '../data/site.json';

export const SLOTS = ['homeLight', 'homeDark', 'confLight', 'confDark'] as const;
export type SlotId = typeof SLOTS[number];
export type Fit = 'cover' | 'contain' | 'stretch';
export interface SlotData { url: string; size: string; pos: string; fit?: Fit; zoom?: number; x?: number; y?: number; ver?: number }
export type SlotMap = Partial<Record<SlotId, SlotData>>;

const apiUrl = typeof SITE.apiUrl === 'string' && /^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(SITE.apiUrl.trim().replace(/\/$/, '')) ? SITE.apiUrl.trim().replace(/\/$/, '') : '';
export const apiBase = apiUrl;
const CACHE_KEY = 'ofst-site-bg';
const CSS_NAME: Record<SlotId, string> = { homeLight: 'home-light', homeDark: 'home-dark', confLight: 'conf-light', confDark: 'conf-dark' };

/* The one CSS rule: used by the public site (through the variables) and by the admin preview box. */
export function bgCss(fit: Fit, zoom: number, x: number, y: number): { size: string; pos: string } {
  const size = fit === 'contain' ? 'contain' : fit === 'stretch' ? '100% 100%' : zoom > 100 ? `${Math.round(zoom)}% auto` : 'cover';
  return { size, pos: `${Math.round(x)}% ${Math.round(y)}%` };
}

/* ---------- public site ---------- */
const safeUrl = (u: unknown) => (typeof u === 'string' && /^(https?:\/\/[^\s"'()\\]+|blob:[^\s"'()\\]+)$/.test(u) ? u : '');
const safeCss = (v: unknown, re: RegExp) => (typeof v === 'string' && re.test(v) ? v : '');
const SIZE_RE = /^(cover|contain|100% 100%|\d{3}% auto)$/, POS_RE = /^\d{1,3}% \d{1,3}%$/;

function clean(raw: any): SlotMap {
  const out: SlotMap = {};
  const src = raw && typeof raw === 'object' && raw.slots && typeof raw.slots === 'object' ? raw.slots : {};
  for (const id of SLOTS) {
    const s = src[id], url = s && safeUrl(s.url);
    if (!url) continue;
    out[id] = { url, size: safeCss(s.size, SIZE_RE) || 'cover', pos: safeCss(s.pos, POS_RE) || 'center' };
  }
  return out;
}

let current: SlotMap = {};
const blobs = new Map<string, string>(); // picture address -> blob: address, used only if the page's CSP refuses the Worker's origin

const isDark = () => {
  const root = document.documentElement, t = root.dataset.ofst || root.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
};

function apply(map: SlotMap) {
  const st = document.documentElement.style;
  for (const id of SLOTS) {
    const n = CSS_NAME[id], s = map[id];
    if (s) {
      st.setProperty('--bg-' + n, `url("${blobs.get(s.url) || s.url}")`);
      st.setProperty('--bg-' + n + '-size', s.size);
      st.setProperty('--bg-' + n + '-pos', s.pos);
    } else {
      st.removeProperty('--bg-' + n); st.removeProperty('--bg-' + n + '-size'); st.removeProperty('--bg-' + n + '-pos');
    }
  }
  applyActive();
}
/* --bg-home-size etc. follow the theme that is showing. */
function applyActive() {
  const st = document.documentElement.style, theme = isDark() ? 'Dark' : 'Light';
  for (const page of ['home', 'conf'] as const) {
    const s = current[(page + theme) as SlotId];
    if (s) { st.setProperty(`--bg-${page}-size`, s.size); st.setProperty(`--bg-${page}-pos`, s.pos); }
    else { st.removeProperty(`--bg-${page}-size`); st.removeProperty(`--bg-${page}-pos`); }
  }
}

function readCache(): SlotMap {
  try { return clean(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')); } catch { return {}; }
}
function writeCache(map: SlotMap) {
  try { Object.keys(map).length ? localStorage.setItem(CACHE_KEY, JSON.stringify({ slots: map })) : localStorage.removeItem(CACHE_KEY); } catch { /* private mode */ }
}

let started = false;
export function initSiteSettings() {
  if (started || typeof window === 'undefined' || typeof document === 'undefined') return;
  started = true;
  current = readCache(); apply(current); // first paint straight from the last visit

  // Follow the light / dark switch (theme-init.js and ThemeButton set data-ofst on <html>).
  try { new MutationObserver(applyActive).observe(document.documentElement, { attributes: true, attributeFilter: ['data-ofst', 'data-theme'] }); } catch { /* old browser */ }

  // If the page's Content-Security-Policy does not list the Worker's origin in img-src, load the pictures as blob: addresses instead.
  document.addEventListener('securitypolicyviolation', (e) => {
    if (!String(e.violatedDirective).startsWith('img-src') || !e.blockedURI.includes('/api/site-image/')) return;
    const hit = Object.values(current).find((s) => s && e.blockedURI.startsWith(s.url.split('?')[0]));
    if (!hit || blobs.has(hit.url)) return;
    fetch(hit.url, { credentials: 'omit' }).then((r) => (r.ok ? r.blob() : Promise.reject(r.status))).then((b) => { blobs.set(hit.url, URL.createObjectURL(b)); apply(current); }).catch(() => {});
  });

  if (!apiUrl) return;
  fetch(apiUrl + '/api/site-settings', { credentials: 'omit', headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((j) => { current = clean(j); apply(current); writeCache(current); })
    .catch(() => { /* the default pictures stay */ });
}

/* ---------- admin ---------- */
export class SettingsApiError extends Error { constructor(public code: string, public status: number) { super(code); } }

async function call(path: string, token: string, init: RequestInit = {}): Promise<any> {
  if (!apiUrl) throw new SettingsApiError('not_configured', 0);
  let res: Response;
  try { res = await fetch(apiUrl + path, { ...init, credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json', Authorization: 'Bearer ' + token, ...(init.headers || {}) } }); }
  catch { throw new SettingsApiError('network', 0); }
  const text = await res.text().catch(() => ''); let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new SettingsApiError(res.status === 401 ? 'session_expired' : String((data && data.error) || 'http_' + res.status), res.status);
  return data;
}
export const settingsApi = {
  configured: !!apiUrl,
  async list(): Promise<SlotMap> {
    if (!apiUrl) return {};
    const r = await fetch(apiUrl + '/api/site-settings?t=' + Date.now(), { credentials: 'omit', cache: 'no-store' });
    if (!r.ok) throw new SettingsApiError('http_' + r.status, r.status);
    const j = await r.json(), src = (j && j.slots) || {}, out: SlotMap = {};
    for (const id of SLOTS) { const s = src[id]; if (s && safeUrl(s.url)) out[id] = { url: s.url, size: String(s.size), pos: String(s.pos), fit: s.fit, zoom: +s.zoom, x: +s.x, y: +s.y, ver: +s.ver }; }
    return out;
  },
  /* The picture as a blob: address (the admin page may only show images from itself, data: and blob:). */
  async blobOf(url: string): Promise<string> {
    const r = await fetch(url, { credentials: 'omit' });
    if (!r.ok) throw new SettingsApiError('http_' + r.status, r.status);
    return URL.createObjectURL(await r.blob());
  },
  putImage: (token: string, slot: SlotId, blob: Blob) => call('/api/admin/site-settings/' + slot + '/image', token, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type } }),
  putSettings: (token: string, slot: SlotId, s: { fit: Fit; zoom: number; posX: number; posY: number }) => call('/api/admin/site-settings/' + slot, token, { method: 'PUT', body: JSON.stringify(s), headers: { 'Content-Type': 'application/json' } }),
  reset: (token: string, slot: SlotId) => call('/api/admin/site-settings/' + slot, token, { method: 'DELETE' }),
};

/* Shrinks a chosen picture in the browser: at most 2400 px wide, webp (jpeg where webp is not supported) at 0.85, then lower
   quality / smaller until it is under the server's limit. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024, MAX_UPLOAD_BYTES = 1_400_000;
export async function shrinkImage(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  try {
    let w = Math.min(2400, bmp.width);
    for (let round = 0; round < 6; round++) {
      const h = Math.max(1, Math.round(bmp.height * (w / bmp.width)));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d'); if (!ctx) throw new Error('canvas');
      ctx.drawImage(bmp, 0, 0, w, h);
      let q = 0.85;
      for (let i = 0; i < 4; i++, q -= 0.1) {
        let blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/webp', q));
        if (!blob || blob.type !== 'image/webp') blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/jpeg', q));
        if (!blob) throw new Error('encode');
        if (blob.size <= MAX_UPLOAD_BYTES) return blob;
      }
      w = Math.round(w * 0.8);
    }
    throw new Error('too_big');
  } finally { bmp.close(); }
}
