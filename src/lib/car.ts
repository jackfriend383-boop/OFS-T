/* OFS/T car renderer: design artwork (ART), signature art preparation (prepareArt), carSVG, the live Stage and thumbnails.
   Ported from assets/js/car.js. The SVG is built as a string (fast to render in bulk and shared by the cart, search and admin
   thumbnails); the Stage animates the live copy imperatively and is wrapped by the <CarStage> React component. Browser-only
   work (artwork preparation, the Stage) never runs on the server. */
import DATA from '../data/designs.json';
import type { Cfg, Kit } from './kit';

const NS = 'http://www.w3.org/2000/svg';
const COLORS = DATA.colors as Record<string, { hex: string }>;
const hex = (k: string) => (COLORS[k] || COLORS[Object.keys(COLORS)[0]]).hex;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c as string] as string));
const q = (s: string, r: ParentNode) => r.querySelector(s) as any;
const qa = (s: string, r: ParentNode) => [...r.querySelectorAll(s)] as any[];
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const IMG_DIR = import.meta.env.BASE_URL + 'assets/img/';
let UID = 0;

/* ---------- Helpers ---------- */
function rng(seed: number) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function mix(a: string, b: string, t: number) { const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
function blob(cx: number, cy: number, r: number, R: () => number, n: number) {
  const pts: number[][] = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, rr = r * (.65 + R() * .6); pts.push([cx + Math.cos(a) * rr * 1.45, cy + Math.sin(a) * rr * .8]); }
  let d = ''; for (let i = 0; i < n; i++) { const p = pts[i], q2 = pts[(i + 1) % n]; if (!i) { const l = pts[n - 1]; d += `M${((l[0] + p[0]) / 2).toFixed(1)} ${((l[1] + p[1]) / 2).toFixed(1)}`; } d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${((p[0] + q2[0]) / 2).toFixed(1)} ${((p[1] + q2[1]) / 2).toFixed(1)}`; } return d + 'Z';
}
const wave = (x0: number, x1: number, yb: number, amp: number, f: number, ph: number) => { let d = ''; for (let x = x0; x <= x1; x += 4) d += (x === x0 ? 'M' : 'L') + x + ' ' + (yb + Math.sin(x / f + ph) * amp).toFixed(1); return d; };

/* Signature artwork from supplied door files.
   pill = door outline inside the image; ring = badge cut-out (outer and inner rounded rects) and the registration mark, all in image px.
   'mask' art is split into black, white, light tone and dark tone so the two tones can be recoloured; 'rgb' art keeps its own colours. */
const ART_SRC: Record<string, any> = {
  flame: { img: IMG_DIR + 'flame-red.webp', mode: 'mask', size: [2000, 846], pill: [22, 60, 1976, 788], outer: [1068, 193, 1885, 657, 120], inner: [1165, 265, 1718, 594, 140], mark: [1588, 532, 46] },
  stealth: { img: IMG_DIR + 'flame-stealth.webp', mode: 'rgb', size: [2000, 859], pill: [39, 73, 1964, 792], outer: [1071, 204, 1872, 662, 120], inner: [1163, 274, 1711, 602, 140], mark: [1603, 562, 46] },
};
const NO_ART = { door: (..._a: any[]) => '', win: (..._a: any[]) => '' };
const SIGNATURE = (DATA.designs as any[]).filter((d) => d.art && ART_SRC[d.art]);

/* ---------- Car photo + sticker zones (coordinates in the 2000×1125 photo) ---------- */
const IMG = IMG_DIR + 'ami-side.webp';
const LOGO = IMG_DIR + 'OFST-icon-white.svg';
const DOOR_RECT = 'x="876" y="658" width="271" height="104" rx="42"';
const WIN = 'M1161 345 L1226 355 L1300 489 L1199 489 Z';
const WHEELS = [[698.5, 747], [1325.5, 747]];
const VIEWS: Record<string, number[]> = { full: [530, 250, 1080, 646], door: [826, 598, 372, 222], window: [1078, 327, 306, 183], thumb: [556, 272, 1032, 594] };
/* Ami versions. The Ami 2025 is the default everywhere; the Pop is offered in the configurator. The Pop photo is scaled and
   placed so its door lines up with the Ami 2025 door; its rear-window zone is the small orange half ring, so the window
   artwork is scaled into it (winT), and its light strip (lights mask) takes the first colour. Pop views keep the same aspect ratios. */
const POP_IMG = IMG_DIR + 'ami-pop.webp', POP_LIGHTS = IMG_DIR + 'ami-pop-lights.png';
const MODEL_DEFS: Record<string, any> = {
  qs: {
    name: 'Ami Ami 2025', img: `href="${IMG}" width="2000" height="1125"`,
    door: DOOR_RECT, win: WIN, winT: '', winStroke: 'stroke="#0A0B0C" stroke-width="3"', rimR: 71, wheels: WHEELS,
    badge: 'x="1016" y="677" width="113" height="56" rx="20"', plate: [1027, 687, 95, 38, 11], dx: 0,
  },
  pop: {
    name: 'Ami Pop', img: `href="${POP_IMG}" x="555.9" y="294.8" width="1376.8" height="656"`,
    door: 'x="878" y="657" width="267" height="106" rx="40"', win: 'M1284.7 448.3 L1282.1 449.2 L1279.4 450.0 L1276.7 450.6 L1274.0 451.0 L1271.2 451.2 L1268.5 451.3 L1265.7 451.1 L1263.0 450.7 L1260.2 450.2 L1257.6 449.4 L1255.0 448.5 L1252.4 447.4 L1250.0 446.1 L1247.6 444.7 L1245.3 443.1 L1243.2 441.3 L1241.2 439.4 L1239.3 437.4 L1237.6 435.2 L1236.0 432.9 L1234.6 430.5 L1233.4 428.1 L1232.3 425.5 L1231.5 422.9 L1230.8 420.2 L1230.3 417.5 L1229.9 414.7 L1229.8 411.9 L1229.9 409.2 L1230.2 406.4 L1230.6 403.7 L1231.3 401.0 L1232.1 398.4 L1233.1 395.8 L1234.3 393.3 L1235.7 390.9 L1237.2 388.6 L1238.9 386.4 L1240.7 384.3 L1242.7 382.3 L1244.8 380.5 L1247.0 378.9 L1247.9 378.3 L1258.9 399.2 L1257.9 400.2 L1256.9 401.2 L1256.1 402.4 L1255.3 403.6 L1254.6 404.8 L1254.1 406.2 L1253.7 407.5 L1253.4 408.9 L1253.2 410.3 L1253.2 411.7 L1253.3 413.2 L1253.5 414.6 L1253.8 416.0 L1254.2 417.3 L1254.8 418.6 L1255.4 419.9 L1256.2 421.1 L1257.1 422.2 L1258.1 423.2 L1259.1 424.2 L1260.3 425.0 L1261.5 425.8 L1262.7 426.5 L1264.1 427.0 L1265.4 427.4 L1266.8 427.7 L1268.2 427.9 L1269.6 427.9 L1271.1 427.8 L1272.5 427.6 L1273.9 427.3 L1273.9 427.3Z', winT: 'translate(1269.5 411.6) scale(0.5575) translate(-1230.5 -417)', winStroke: 'stroke="#0A0B0C" stroke-opacity=".55" stroke-width="1.2"', rimR: 78, wheels: [[694.7, 744.4], [1332.7, 743.6]],
    lights: { x: 600.7, y: 522.0, w: 20.8, h: 22.4, mask: POP_LIGHTS },
    badge: 'x="1023.5" y="677.5" width="113" height="55.5" rx="22"', plate: [1033, 685, 85, 42, 13], dx: 1,
    views: { full: [466, 250, 1080, 646], door: [826, 598, 372, 222], window: [1154, 342, 230, 138], thumb: [490, 272, 1032, 594] },
  },
};
const MOD = (m: unknown) => (typeof m === 'string' && Object.prototype.hasOwnProperty.call(MODEL_DEFS, m) ? MODEL_DEFS[m] : MODEL_DEFS.qs);
const viewsOf = (m: unknown): Record<string, number[]> => MOD(m).views || VIEWS;
const fillDoor = (c: string) => `<rect x="860" y="645" width="300" height="130" fill="${c}"/>`;
const fillWin = (c: string) => `<rect x="1150" y="335" width="160" height="165" fill="${c}"/>`;

/* Each design draws into the door panel and the rear window; everything is clipped to those two shapes. */
export const ART: Record<string, { door: (a: string, b: string, u: string) => string; win: (a: string, b: string, u: string) => string }> = {
  'street-flow': {
    door: (a, b) => fillDoor(a) + `<path d="M860 744 C925 668 1040 648 1160 684 L1160 708 C1050 676 958 690 904 775 L860 775Z" fill="${b}"/><circle cx="906" cy="688" r="12" fill="${b}"/>`,
    win: (a, b) => fillWin(a) + `<path d="M1150 402 C1200 382 1252 396 1300 432 L1300 452 C1250 420 1200 412 1150 428Z" fill="${b}"/><ellipse cx="1262" cy="480" rx="46" ry="27" fill="${b}"/>` },
  'racing-lines': {
    door: (a, b) => [[892, 42], [946, 22], [980, 11], [1003, 5]].map(([s, w]) => `<polygon points="${s},775 ${s + w},775 ${s + w + 52},645 ${s + 52},645" fill="${a}"/>`).join('') + `<rect x="860" y="667" width="300" height="5" fill="${b}"/>`,
    win: (a, b) => `<polygon points="1160,500 1202,500 1272,335 1230,335" fill="${a}"/><polygon points="1214,500 1228,500 1298,335 1284,335" fill="${b}"/>` },
  'neon-wave': {
    door: (a, b) => [[9, a, 1, 700], [3, b, 1, 716], [6, a, .7, 729], [2, b, .9, 684], [4, a, .5, 752]].map(([w, c, o, y]: any[], k) => `<path d="${wave(860, 1160, y, 8, 24, k * .9)}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" opacity="${o}"/>`).join(''),
    win: (a, b) => [[8, a, 1, 392], [3, b, 1, 408], [6, a, .7, 424], [2, b, .9, 440], [5, a, .55, 458]].map(([w, c, o, y]: any[], k) => `<path d="${wave(1150, 1308, y, 7, 16, k * .9)}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" opacity="${o}"/>`).join('') },
  'retro-stripe': {
    door: (a, b) => `<rect x="860" y="688" width="300" height="17" fill="${a}"/><rect x="860" y="711" width="300" height="9" fill="${b}"/><rect x="860" y="726" width="300" height="5" fill="${a}"/>`,
    win: (a, b) => `<g transform="rotate(-24 1222 450)"><rect x="1120" y="428" width="240" height="17" fill="${a}"/><rect x="1120" y="451" width="240" height="9" fill="${b}"/><rect x="1120" y="466" width="240" height="5" fill="${a}"/></g>` },
  'urban-camo': {
    door: (a, b) => { const R = rng(7), c = [b, mix(a, '#000000', .45), mix(b, '#000000', .4)]; let s = fillDoor(a); for (let i = 0; i < 40; i++) s += `<path d="${blob(866 + R() * 290, 650 + R() * 120, 8 + R() * 12, R, 7)}" fill="${c[i % 3]}"/>`; return s; },
    win: (a, b) => { const R = rng(19), c = [b, mix(a, '#000000', .45), mix(b, '#000000', .4)]; let s = fillWin(a); for (let i = 0; i < 26; i++) s += `<path d="${blob(1152 + R() * 156, 338 + R() * 160, 7 + R() * 11, R, 7)}" fill="${c[i % 3]}"/>`; return s; } },
  'pixel': {
    door: (a, b) => { const R = rng(11); let s = ''; for (let x = 876; x < 1150; x += 11) for (let y = 658; y < 764; y += 11) { const t = (x - 876) / 271; if (R() < t * t * 1.15 + .03) s += `<rect x="${x + 1}" y="${y + 1}" width="9" height="9" fill="${R() < .72 ? a : b}"/>`; } return s; },
    win: (a, b) => { const R = rng(5); let s = ''; for (let x = 1158; x < 1306; x += 11) for (let y = 345; y < 492; y += 11) { const t = (y - 345) / 144; if (R() < t * 1.05 + .05) s += `<rect x="${x + 1}" y="${y + 1}" width="9" height="9" fill="${R() < .72 ? a : b}"/>`; } return s; } },
  'checker': {
    door: (a, b, u) => `<defs><pattern id="${u}-ck" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${a}"/><rect x="8" y="8" width="8" height="8" fill="${a}"/></pattern></defs>
      <polygon points="985,775 1062,645 1160,645 1160,775" fill="url(#${u}-ck)"/><line x1="966" y1="775" x2="1043" y2="645" stroke="${b}" stroke-width="7"/><line x1="950" y1="775" x2="1027" y2="645" stroke="${b}" stroke-width="2.5"/>`,
    win: (a, b, u) => `<defs><pattern id="${u}-cw" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${a}"/><rect x="8" y="8" width="8" height="8" fill="${a}"/></pattern></defs>
      ${fillWin('url(#' + u + '-cw)')}<rect x="1150" y="335" width="160" height="40" fill="${b}"/>` },
  'halftone': {
    door: (a, b) => { let s = '', row = 0; for (let y = 660; y < 766; y += 8, row++) for (let x = 878 + (row % 2) * 4.5; x < 1150; x += 9) { const r = (x - 876) / 271 * 4.6 - .3; if (r > .4) s += `<circle cx="${x}" cy="${y}" r="${Math.min(r, 4.7).toFixed(2)}" fill="${a}"/>`; } return s + `<rect x="860" y="660" width="300" height="4" fill="${b}"/>`; },
    win: (a, b) => { let s = '', row = 0; for (let y = 347; y < 492; y += 8, row++) for (let x = 1156 + (row % 2) * 4.5; x < 1306; x += 9) { const r = (y - 345) / 144 * 4.6 + .2; s += `<circle cx="${x}" cy="${y}" r="${Math.min(r, 4.7).toFixed(2)}" fill="${a}"/>`; } return s; } },
  'pinstripe': {
    door: (a, b) => `<rect x="885" y="667" width="253" height="86" rx="34" fill="none" stroke="${a}" stroke-width="4"/><rect x="894" y="676" width="235" height="68" rx="26" fill="none" stroke="${b}" stroke-width="1.5"/>`,
    win: (a, b) => `<path d="M1169 355 L1221 364 L1286 481 L1205 481 Z" fill="none" stroke="${a}" stroke-width="4" stroke-linejoin="round"/><path d="M1177 365 L1216 372 L1274 473 L1211 473 Z" fill="none" stroke="${b}" stroke-width="1.5" stroke-linejoin="round"/>` },
  'bolt': {
    door: (a, b) => { const p = '886,690 1002,670 968,706 1084,686 928,758 962,722 894,730'; return `<polygon points="${p}" fill="${b}" transform="translate(5 4)"/><polygon points="${p}" fill="${a}"/>`; },
    win: (a, b) => fillWin(a) + `<polygon points="1180,370 1236,380 1214,414 1262,422 1203,486 1220,434 1188,429" fill="${b}"/>` },
  'contour': {
    door: (a, b) => { let s = ''; for (let k = 1; k <= 16; k++) { const r = 12 * k; let d = ''; for (let i = 0; i <= 64; i++) { const t = i / 64 * Math.PI * 2, rr = r * (1 + .12 * Math.sin(3 * t + k * .6) + .06 * Math.sin(5 * t - k)); d += (i ? 'L' : 'M') + (930 + Math.cos(t) * rr * 1.6).toFixed(1) + ' ' + (770 + Math.sin(t) * rr * .8).toFixed(1); } s += `<path d="${d}Z" fill="none" stroke="${k % 4 === 0 ? b : a}" stroke-width="${k % 4 === 0 ? 2.6 : 1.5}"/>`; } return s; },
    win: (a, b) => { let s = ''; for (let k = 1; k <= 16; k++) { const r = 11 * k; let d = ''; for (let i = 0; i <= 64; i++) { const t = i / 64 * Math.PI * 2, rr = r * (1 + .12 * Math.sin(3 * t + k * .5) + .06 * Math.sin(4 * t - k)); d += (i ? 'L' : 'M') + (1292 + Math.cos(t) * rr * 1.1).toFixed(1) + ' ' + (342 + Math.sin(t) * rr).toFixed(1); } s += `<path d="${d}Z" fill="none" stroke="${k % 4 === 0 ? b : a}" stroke-width="${k % 4 === 0 ? 2.6 : 1.5}"/>`; } return s; } },
  'sunset': {
    door: (a, b, u) => `<defs><linearGradient id="${u}-sd" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs>
      <rect x="860" y="690" width="300" height="13" fill="url(#${u}-sd)"/><rect x="860" y="709" width="300" height="9" fill="url(#${u}-sd)"/><rect x="860" y="724" width="300" height="6" fill="url(#${u}-sd)"/>`,
    win: (a, b, u) => { let bands = '', y = 372, h = 20, g = 3; while (y < 492) { bands += `<rect x="1150" y="${y.toFixed(1)}" width="160" height="${h.toFixed(1)}"/>`; y += h + g; h = Math.max(5, h - 3); g += 1.6; }
      return `<defs><linearGradient id="${u}-sw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/></linearGradient><clipPath id="${u}-sb">${bands}</clipPath></defs>
      <circle cx="1236" cy="492" r="126" fill="url(#${u}-sw)" clip-path="url(#${u}-sb)"/>`; } },
};

/* Signature artwork: the whole door shape maps onto the door panel; a section of the same art (left of the badge) fills the rear window.
   The artwork is prepared once in the browser (badge cut-out filled in, tones separated) and shared by every car on the page.
   Performance: the working resolution follows the device (ART_K of the 2000px source: 1000px on small screens / low memory,
   1600px otherwise), the main thread is yielded to between phases, the PNG/WebP is encoded off-thread (toBlob) and referenced
   through a short blob: URL, and the result is cached in sessionStorage (if it fits) so other pages skip the work. */
const ART_K = (() => {
  if (typeof window === 'undefined') return .8;
  const small = typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
  const lowMem = (navigator as any).deviceMemory && (navigator as any).deviceMemory <= 4;
  return small || lowMem ? .5 : .8;
})();
const ART_URL: Record<string, string> = {};
const inRR = (x: number, y: number, [x0, y0, x1, y1, r]: number[]) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const yieldMain = () => new Promise<void>((r) => setTimeout(r, 0));
function setArt(key: string, url: string) {
  ART_URL[key] = url;
  qa(`image[data-art="${key}"]`, document).forEach((el) => el.setAttribute('href', url));
}
function dataToBlobURL(s: string) {
  try {
    const comma = s.indexOf(','), mime = s.slice(5, s.indexOf(';')), bin = atob(s.slice(comma + 1));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([u8], { type: mime }));
  } catch { return null; }
}
async function prepareArt(key: string) {
  const S = ART_SRC[key], k = ART_K, ck = `ofst-art:${key}:${k}:1`;
  let cached: string | null = null;
  try { cached = sessionStorage.getItem(ck); } catch { /* storage unavailable */ }
  if (cached && /^data:image\/(png|webp);base64,/.test(cached)) { const u = dataToBlobURL(cached); if (u) { setArt(key, u); return; } }
  const img = new Image(); img.src = S.img; await img.decode();
  const w = Math.round(S.size[0] * k), h = Math.round(S.size[1] * k), N = w * h;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h), d = id.data;
  await yieldMain();
  // 1. Mark the badge cut-out ring and the registration mark as holes to fill (only inside their bounding boxes).
  const hole = new Uint8Array(N), [mx, my, mr] = S.mark;
  const mark = (x0: number, y0: number, x1: number, y1: number, test: (sx: number, sy: number) => boolean) => {
    const ya = Math.max(0, Math.floor(y0 * k)), yb = Math.min(h - 1, Math.ceil(y1 * k)), xa = Math.max(0, Math.floor(x0 * k)), xb = Math.min(w - 1, Math.ceil(x1 * k));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) if (test(x / k, y / k)) hole[y * w + x] = 1;
  };
  mark(S.outer[0], S.outer[1], S.outer[2], S.outer[3], (sx, sy) => inRR(sx, sy, S.outer) && !inRR(sx, sy, S.inner));
  mark(mx - mr, my - mr, mx + mr, my + mr, (sx, sy) => (sx - mx) ** 2 + (sy - my) ** 2 < mr * mr);
  // 2. Tone labels: 0 black, 1 white, 2 light tone, 3 dark tone.
  let lab: Uint8Array | null = null;
  if (S.mode === 'mask') {
    lab = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], mx_ = Math.max(r, g, b), mn = Math.min(r, g, b);
      lab[i] = mx_ - mn < 60 ? (r + g + b > 384 ? 1 : 0) : (mx_ >= 204 ? 2 : 3);
    }
    await yieldMain();
    // Edge pixels between two tones get misread; give isolated pixels the label of their neighbours.
    const out = lab.slice(), cnt = new Uint8Array(4);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x; cnt.fill(0);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) cnt[lab[i + dy * w + dx]]++;
      if (cnt[lab[i]] < 3) { let best = 0; for (let q2 = 1; q2 < 4; q2++) if (cnt[q2] > cnt[best]) best = q2; out[i] = best; }
    }
    lab = out;
    await yieldMain();
  }
  // 3. Fill holes by growing the surrounding shapes inwards (nearest pixel wins).
  const from = new Int32Array(N).fill(-1), queue = new Int32Array(N); let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) if (!hole[i]) { from[i] = i; const x = i % w; if ((x > 0 && hole[i - 1]) || (x < w - 1 && hole[i + 1]) || (i >= w && hole[i - w]) || (i + w < N && hole[i + w])) queue[qt++] = i; }
  const grow = (i: number, j: number) => { if (from[j] < 0) { from[j] = from[i]; queue[qt++] = j; } };
  while (qh < qt) {
    const i = queue[qh++], x = i % w;
    if (x > 0) grow(i, i - 1);
    if (x < w - 1) grow(i, i + 1);
    if (i >= w) grow(i, i - w);
    if (i + w < N) grow(i, i + w);
  }
  const TONE = [[0, 0, 0], [0, 0, 255], [255, 0, 0], [0, 255, 0]];
  for (let i = 0; i < N; i++) {
    const s = from[i] < 0 ? i : from[i];
    if (lab) { const t = TONE[lab[s]]; d[i * 4] = t[0]; d[i * 4 + 1] = t[1]; d[i * 4 + 2] = t[2]; }
    else if (s !== i) { d[i * 4] = d[s * 4]; d[i * 4 + 1] = d[s * 4 + 1]; d[i * 4 + 2] = d[s * 4 + 2]; }
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  // Tone masks must stay lossless (PNG); full-colour art can be WebP (browsers without WebP encoding fall back to PNG).
  const blobOut: Blob | null = (c as any).toBlob ? await new Promise<Blob | null>((r) => c.toBlob(r, S.mode === 'mask' ? 'image/png' : 'image/webp', .92)) : null;
  if (!blobOut) { setArt(key, c.toDataURL('image/png')); return; }
  setArt(key, URL.createObjectURL(blobOut));
  if (blobOut.size < 1200000 && typeof FileReader !== 'undefined') {
    const fr = new FileReader();
    fr.onload = () => { try { sessionStorage.setItem(ck, fr.result as string); } catch { /* quota */ } };
    fr.readAsDataURL(blobOut);
  }
}
const toneMatrix = (a: string, b: string) => {
  const p = (h: string) => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4));
  const L = p(a), Dk = p(b);
  return [0, 1, 2].map((ch) => `${L[ch]} ${Dk[ch]} 1 0 0`).join(' ') + ' 0 0 0 1 0';
};
SIGNATURE.forEach((s) => {
  const S = ART_SRC[s.art], [l, t, r, b] = S.pill, i = 6;
  const art = (x: number, y: number, w: number, h: number, vb: number[], a: string, bb: string, u: string) => {
    const k = ART_K;
    const filt = S.mode === 'mask' ? `<filter id="${u}-tone" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${toneMatrix(a, bb)}"/></filter>` : '';
    return `${filt}<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${vb.map((v) => v * k).join(' ')}" preserveAspectRatio="none" overflow="hidden">
      <image data-art="${s.art}"${ART_URL[s.art] ? ` href="${ART_URL[s.art]}"` : ''} width="${S.size[0] * k}" height="${S.size[1] * k}"${filt ? ` filter="url(#${u}-tone)"` : ''}/></svg>`;
  };
  ART[s.id] = {
    door: (a, bb, u) => art(872, 654, 279, 112, [l + i, t + i, r - l - 2 * i, b - t - 2 * i], a, bb, u + 'd'),
    win: (a, bb, u) => art(1161, 345, 139, 144, [l + 370, t + 8, 650, b - t - 16], a, bb, u + 'w'),
  };
});
/* One artwork at a time (the red flame first: it's the hero's and the configurator's opening design). Call once, in the browser. */
let artStarted = false;
export function initArt() {
  if (artStarted || typeof document === 'undefined') return;
  artStarted = true;
  Object.keys(ART_SRC).reduce((p, k) => p.then(() => prepareArt(k)).catch(() => {}), Promise.resolve());
}

const plateText = (o: Partial<Cfg>) => (o.numberOn && o.number ? esc(o.number) : '');

/* Accessible name of a car picture: design, colours (live stage only), Ami version and badge text. */
function carLabel(kit: Kit, o: Cfg, full: boolean) {
  const d = kit.D(o.design)!, T = kit.T;
  let s = T('carDesign', { name: d.name });
  if (full) {
    const c1 = kit.COLORS[o.c1], c2 = kit.COLORS[o.c2], finish = T(o.finish === 'gloss' ? 'glossLc' : 'matteLc');
    s += d.fixed || !c1 || !c2 ? T('carInOrig', { finish }) : T('carIn', { c1: c1.name, c2: c2.name, finish });
  }
  s += T('carOn', { model: MOD(o.model).name });
  if (full && o.numberOn && o.number) s += T('carBadge', { text: o.number });
  return s;
}

interface CarOpts extends Cfg { uid: string; view: string; live?: boolean; decorative?: boolean }
export function carSVG(kit: Kit, o: CarOpts): string {
  const u = o.uid, a = hex(o.c1), b = hex(o.c2), A = ART[o.design] || NO_ART, M = MOD(o.model), V = viewsOf(o.model), v = V[o.view] || V.full, live = !!o.live;
  const rims = live ? M.wheels.map(([x, y]: number[]) => `<g transform="translate(${x} ${y})"><g class="rimspin"><g clip-path="url(#${u}-rim)"><image ${M.img} transform="translate(${-x} ${-y})"/></g></g></g>`).join('') : '';
  const lights = M.lights ? ((L: any) => `<mask id="${u}-lt" maskUnits="userSpaceOnUse" x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}"><image href="${L.mask}" x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" preserveAspectRatio="none"/></mask><rect class="lights" x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" fill="${a}" mask="url(#${u}-lt)" style="transition:fill .6s"/>`)(M.lights) : '';
  const P = M.plate;
  const a11y = o.decorative ? 'aria-hidden="true" focusable="false"' : `role="img" aria-label="${esc(carLabel(kit, o, live))}"`;
  return `<svg class="car-svg" viewBox="${v.join(' ')}" xmlns="${NS}" ${a11y}>
  <defs>
    <clipPath id="${u}-door"><rect ${M.door}/></clipPath>
    <clipPath id="${u}-win"><path d="${M.win}"/></clipPath>
    <clipPath id="${u}-zones"><rect ${M.door}/><path d="${M.win}"/></clipPath>
    <clipPath id="${u}-badge"><rect ${M.badge}/></clipPath>
    <clipPath id="${u}-rim"><circle r="${M.rimR}"/></clipPath>
    <linearGradient id="${u}-ds" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></linearGradient>
    <linearGradient id="${u}-ws" x1="0" y1="0" x2=".5" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
    <linearGradient id="${u}-sh" x1="0" y1="0" x2="1" y2=".4"><stop offset=".25" stop-color="#fff" stop-opacity="0"/><stop offset=".4" stop-color="#fff" stop-opacity=".22"/><stop offset=".47" stop-color="#fff" stop-opacity=".04"/><stop offset=".7" stop-color="#fff" stop-opacity="0"/><stop offset=".78" stop-color="#fff" stop-opacity=".12"/><stop offset=".84" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="${u}-pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#262626"/><stop offset="1" stop-color="#141414"/></linearGradient>
    <linearGradient id="${u}-sq" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  <g class="drive">
    <image ${M.img}/>
    ${lights}
    ${rims}
    <g clip-path="url(#${u}-door)">
      <rect x="860" y="645" width="300" height="130" fill="#18191A"/>
      <g class="slot-door"><g>${A.door(a, b, u + 'x')}</g></g>
      <rect x="860" y="645" width="300" height="130" fill="url(#${u}-ds)"/>
      <rect class="shine" x="860" y="645" width="300" height="130" fill="url(#${u}-sh)" style="opacity:${o.finish === 'gloss' ? 1 : .25}"/>
    </g>
    <g clip-path="url(#${u}-win)"><g${M.winT ? ` transform="${M.winT}"` : ''}>
      <rect x="1150" y="335" width="160" height="165" fill="#1C2022"/>
      <g class="slot-win"><g>${A.win(a, b, u + 'x')}</g></g>
      <rect x="1150" y="335" width="160" height="165" fill="url(#${u}-ws)"/>
      <rect class="shine" x="1150" y="335" width="145" height="165" fill="url(#${u}-sh)" style="opacity:${o.finish === 'gloss' ? 1 : .25}"/>
    </g></g>
    <rect ${M.door} fill="none" stroke="#0E0F10" stroke-width="2.5"/>
    <path d="${M.win}" fill="none" ${M.winStroke} stroke-linejoin="round"/>
    <path d="M876 741.5 H1147" stroke="#060606" stroke-width="3"/><path d="M880 744.2 H1143" stroke="#fff" stroke-opacity=".07" stroke-width="1"/><path d="M1011.5 743 V762" stroke="#060606" stroke-width="2.5"/>
    <image ${M.img} clip-path="url(#${u}-badge)"/>
    <rect x="${P[0]}" y="${P[1]}" width="${P[2]}" height="${P[3]}" rx="${P[4]}" fill="url(#${u}-pl)"/><g${M.dx ? ` transform="translate(${M.dx} 0)"` : ''}>
    <mask id="${u}-lg" maskUnits="userSpaceOnUse" x="1050" y="684" width="50" height="44"><image href="${LOGO}" x="1056" y="687" width="37" height="37"/></mask>
    <rect class="plate-logo" x="1050" y="684" width="50" height="44" fill="${a}" mask="url(#${u}-lg)" style="opacity:${plateText(o) ? 0 : 1};transition:opacity .4s"/>
    <text class="plate" x="1074.5" y="711" text-anchor="middle" fill="${a}" style="font:800 15px Archivo,sans-serif;font-stretch:125%;letter-spacing:.06em">${plateText(o)}</text></g>
    ${live ? `<g clip-path="url(#${u}-zones)"><rect class="squeegee" x="-10" y="330" width="20" height="440" fill="url(#${u}-sq)"/></g>` : ''}
  </g></svg>`;
}

/* ---------- Live stage (hero + configurator) ---------- */
const easeIO = (k: number) => (k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
export class Stage {
  host: HTMLElement; kit: Kit; cfg: Cfg; vname = 'full';
  u = ''; lc = 0; vb: number[] = []; vRaf = 0; dRaf = 0;
  svg: any; slots: any[] = []; sq: any; drive: any; plate: any; logo: any; shines: any[] = []; rims: any[] = []; lights: any[] = []; defs: any;
  constructor(host: HTMLElement, kit: Kit, cfg: Cfg) { this.host = host; this.kit = kit; this.cfg = { ...cfg }; this.build(); }
  /* (Re)build the SVG for the current config (a different Ami version needs a different photo and zones), keeping the camera view. */
  build() {
    const cfg = this.cfg, V = viewsOf(cfg.model);
    cancelAnimationFrame(this.vRaf); cancelAnimationFrame(this.dRaf);
    if (!V[this.vname]) this.vname = 'full';
    this.u = 'st' + (++UID); this.lc = 0; this.vb = V[this.vname].slice();
    this.host.innerHTML = carSVG(this.kit, { ...cfg, uid: this.u, view: this.vname, live: true });
    this.svg = this.host.firstElementChild;
    this.slots = [q('.slot-door', this.svg), q('.slot-win', this.svg)];
    this.sq = q('.squeegee', this.svg); this.drive = q('.drive', this.svg); this.plate = q('.plate', this.svg); this.logo = q('.plate-logo', this.svg);
    this.shines = qa('.shine', this.svg); this.rims = qa('.rimspin', this.svg); this.lights = qa('.lights', this.svg); this.defs = q('defs', this.svg);
  }
  /* The language changed: new accessible name, same picture. */
  setKit(kit: Kit) { this.kit = kit; if (this.svg) this.svg.setAttribute('aria-label', carLabel(kit, this.cfg, true)); }
  set(cfg: Cfg) {
    const p = this.cfg; this.cfg = { ...cfg };
    if (!this.kit.D(cfg.design)) return;
    if ((p.model || 'qs') !== (cfg.model || 'qs')) { this.build(); this.driveIn(); return; }
    this.svg.setAttribute('aria-label', carLabel(this.kit, cfg, true));
    if (p.finish !== cfg.finish) this.shines.forEach((s) => (s.style.opacity = cfg.finish === 'gloss' ? 1 : .25));
    if (p.design !== cfg.design || p.c1 !== cfg.c1 || p.c2 !== cfg.c2) this.wipe();
    const t = plateText(cfg);
    if (t !== plateText(p) || p.c1 !== cfg.c1) {
      this.plate.textContent = cfg.numberOn ? cfg.number : '';
      this.plate.setAttribute('fill', hex(cfg.c1));
      this.logo.setAttribute('fill', hex(cfg.c1));
      this.lights.forEach((l) => l.setAttribute('fill', hex(cfg.c1)));
      this.logo.style.opacity = t ? 0 : 1;
      if (!reduced() && t && !plateText(p)) this.plate.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500 });
    }
  }
  wipe() {
    const C = this.cfg, lid = this.u + 'L' + (++this.lc), A = ART[C.design] || NO_ART;
    const layers = [A.door, A.win].map((fn, i) => { const g = document.createElementNS(NS, 'g'); g.innerHTML = fn(hex(C.c1), hex(C.c2), lid + i); return g; });
    if (reduced()) { layers.forEach((g, i) => this.slots[i].replaceChildren(g)); return; }
    const cp = document.createElementNS(NS, 'clipPath'); cp.id = lid + 'w';
    const r = document.createElementNS(NS, 'rect');
    [['x', 860], ['y', 320], ['height', 460], ['width', 0]].forEach(([k, v]) => r.setAttribute(k as string, String(v)));
    cp.append(r); this.defs.append(cp);
    layers.forEach((g, i) => { g.setAttribute('clip-path', `url(#${cp.id})`); this.slots[i].append(g); });
    const t0 = performance.now(), dur = 900, span = 440; this.sq.style.opacity = 1;
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / dur), w = easeIO(k) * span;
      r.setAttribute('width', w.toFixed(1)); this.sq.setAttribute('transform', `translate(${(860 + w).toFixed(1)} 0)`);
      if (k < 1) { requestAnimationFrame(step); return; }
      layers.forEach((g) => { g.removeAttribute('clip-path'); while (g.previousSibling) g.previousSibling.remove(); });
      cp.remove();
      if (this.slots[0].lastChild === layers[0]) this.sq.style.opacity = 0;
    };
    requestAnimationFrame(step);
  }
  driveIn() {
    if (reduced()) return;
    const t0 = performance.now(), dur = 1500, dist = 560, R = 97;
    cancelAnimationFrame(this.dRaf);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur), off = dist * (1 - easeOut(k));
      this.drive.setAttribute('transform', `translate(${off.toFixed(1)} 0)`);
      this.drive.style.opacity = Math.min(1, k * 3);
      const deg = off / R * 180 / Math.PI;
      this.rims.forEach((g) => g.setAttribute('transform', `rotate(${deg.toFixed(2)})`));
      if (k < 1) this.dRaf = requestAnimationFrame(step);
    };
    this.dRaf = requestAnimationFrame(step);
  }
  view(name: string) {
    const V = viewsOf(this.cfg.model);
    this.vname = V[name] ? name : 'full';
    this.animateTo(V[this.vname], 800);
  }
  /* Zoom in (f < 1) or out (f > 1) around the middle of what is on screen, never wider than the full car or closer than 30%. */
  zoom(f: number) {
    const full = viewsOf(this.cfg.model).full, [x, y, w, h] = this.vb;
    const nw = Math.min(full[2], Math.max(full[2] * 0.3, w * f)), nh = nw * (full[3] / full[2]);
    this.animateTo(this.clampBox([x + w / 2 - nw / 2, y + h / 2 - nh / 2, nw, nh]), 450);
  }
  /* Drag the zoomed picture by (dx, dy) screen pixels. */
  pan(dx: number, dy: number) {
    const r = this.svg.getBoundingClientRect(); if (!r.width) return;
    const k = this.vb[2] / r.width;
    cancelAnimationFrame(this.vRaf);
    this.vb = this.clampBox([this.vb[0] - dx * k, this.vb[1] - dy * k, this.vb[2], this.vb[3]]);
    this.svg.setAttribute('viewBox', this.vb.map((n) => n.toFixed(2)).join(' '));
  }
  /* True when closer than the full-car view (the picture can then be dragged). */
  zoomed() { return this.vb[2] < viewsOf(this.cfg.model).full[2] - 1; }
  /* Keep a camera box inside the full-car frame. */
  clampBox(b: number[]) {
    const f = viewsOf(this.cfg.model).full;
    return [Math.min(Math.max(b[0], f[0]), f[0] + f[2] - b[2]), Math.min(Math.max(b[1], f[1]), f[1] + f[3] - b[3]), b[2], b[3]];
  }
  animateTo(to: number[], ms: number) {
    const from = this.vb.slice(), t0 = performance.now(), dur = reduced() ? 1 : ms;
    cancelAnimationFrame(this.vRaf);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur), e = easeIO(k);
      this.vb = from.map((f, i) => f + (to[i] - f) * e);
      this.svg.setAttribute('viewBox', this.vb.map((n) => n.toFixed(2)).join(' '));
      if (k < 1) this.vRaf = requestAnimationFrame(step);
    };
    this.vRaf = requestAnimationFrame(step);
  }
  destroy() { cancelAnimationFrame(this.vRaf); cancelAnimationFrame(this.dRaf); }
}

/* ---------- Thumbnails ---------- */
/* decorative: inside a link/button/option that already names the design, so the picture is hidden from assistive tech. */
export const thumbSVG = (kit: Kit, cfg: Cfg, decorative: boolean) => carSVG(kit, { ...cfg, uid: 't' + (++UID), view: 'thumb', decorative: !!decorative });
/* Same aspect ratio as a thumbnail, so nothing shifts when the real one is drawn. */
export const THUMB_PLACEHOLDER = '<svg class="car-svg" viewBox="556 272 1032 594" aria-hidden="true" focusable="false"></svg>';

/* ---------- View-button icons (configurator) ----------
   Drawn from the same data as the car: the Ami's outline (a pre-made solid silhouette of each version's photo),
   the door sticker zone and the rear-window sticker zone. Filled with currentColor so they follow the theme. */
export function viewIcon(model: unknown, kind: 'full' | 'door' | 'window') {
  const M = MOD(model), V = viewsOf(model), m = typeof model === 'string' && MODEL_DEFS[model] ? model : 'qs';
  if (kind === 'full') {
    // ami-sil-<version>.png: a solid, smoothed outline made from the car photo (same placement as the photo), tinted with currentColor.
    const f = 'vi-sil-' + m, img = M.img.replace(/href="[^"]*"/, `href="${IMG_DIR}ami-sil-${m}.png"`);
    return `<svg viewBox="${V.full.join(' ')}" aria-hidden="true" focusable="false"><defs><filter id="${f}" color-interpolation-filters="sRGB">`
      + `<feFlood flood-color="currentColor"/><feComposite in2="SourceAlpha" operator="in"/></filter></defs><image ${img} filter="url(#${f})"/></svg>`;
  }
  if (kind === 'door') return `<svg viewBox="${V.door.join(' ')}" aria-hidden="true" focusable="false"><rect ${M.door} fill="currentColor"/></svg>`;
  return `<svg viewBox="${V.window.join(' ')}" aria-hidden="true" focusable="false"><path d="${M.win}" fill="currentColor"/></svg>`;
}
