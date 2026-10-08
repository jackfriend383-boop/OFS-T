/* OFS/T car renderer: design artwork (ART), signature art preparation (prepareArt), carSVG, the live Stage and thumbnails.
   Ported from assets/js/car.js. The SVG is built as a string (fast to render in bulk and shared by the cart, search and admin
   thumbnails); the Stage animates the live copy imperatively and is wrapped by the <CarStage> React component. Browser-only
   work (artwork preparation, the Stage) never runs on the server. */
import DATA from '../data/designs.json';
import { TRIMS, includedPieces, normPieces, type Cfg, type Kit } from './kit';

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
    name: 'Ami 2025', img: `href="${IMG}" width="2000" height="1125"`,
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

/* ---------- Camera angles (Ami 2025) ----------
   Photos: assets/img/ami/<car colour>-<angle>.webp, all 2000×1125 and lined up with the side photo's car. The side view keeps the
   coordinates above. For the ¾ views each sticker zone is the side zone seen in perspective: its 4 corners (TL, TR, BR, BL) are
   traced on the photo (dq door, wq rear window, bq badge), and side-view artwork is mapped onto them (see warp()).
   The front view shows no sticker zone. The Ami Pop has only its side photo for now. */
export type Angle = 'front' | 'front34' | 'side' | 'back';
const QS_ANGLES: Angle[] = ['front', 'front34', 'side', 'back'];
export const anglesOf = (m: unknown): Angle[] => (MOD(m) === MODEL_DEFS.qs ? QS_ANGLES.slice() : ['side']);
type Pt = number[];
const QS_ZONES: Record<string, { dq?: Pt[]; wq?: Pt[]; bq?: Pt[]; views: Record<string, number[]> }> = {
  front: { views: { full: [412.3, 258.6, 1173.4, 701.9], thumb: [438.7, 287, 1120.6, 645] } },
  front34: {
    dq: [[1012.4, 645.8], [1242.8, 632.6], [1241, 731.7], [1010.9, 751.5]], wq: [[1223.8, 327.8], [1331.9, 314], [1359.1, 483], [1242.8, 477.7]],
    bq: [[1134.8, 657.5], [1228, 651.7], [1227.1, 705.2], [1133.9, 712.5]], views: { full: [462, 244.7, 1121, 670.5], thumb: [487.2, 271.9, 1070.6, 616.2] },
  },
  back: {
    dq: [[731.3, 634.9], [829.4, 645.7], [832.6, 747.7], [733.8, 727.1]], wq: [[875.8, 335.3], [971.3, 330.1], [928.7, 497.7], [839.1, 492.2]],
    bq: [[780, 657.9], [822.8, 663.4], [824.5, 717.9], [781.5, 710.1]], views: { full: [532.9, 242.9, 1117.1, 668.2], thumb: [558.1, 270, 1066.9, 614.1] },
  },
};
// One photo was taken from a different camera position, so its zones are traced separately (window refitted by eye to the glass).
const ZONE_OVR: Record<string, { dq: Pt[]; wq: Pt[]; bq: Pt[]; win?: string }> = {
  'browncolor-front34': {
    dq: [[1081.1, 649.4], [1281.8, 629.2], [1283.2, 732.3], [1084.1, 753]], wq: [[1248, 331], [1366, 327], [1370, 478], [1252, 478]],
    bq: [[1185.5, 658], [1268.8, 649.5], [1269.6, 705.1], [1186.7, 713.6]],
    // From this lower camera the rear window looks narrower and steeper than the side shape in perspective: traced outline.
    win: 'M1264 342 L1325 345 L1357 470 L1299 470 Z',
  },
};
// Side-view rectangles the corner quads correspond to (door rect, rear-window box, badge rect).
const SIDE_R = { door: [876, 658, 1147, 762], win: [1150, 335, 1310, 500], badge: [1016, 677, 1129, 733] };
const rectPts = ([x0, y0, x1, y1]: number[]): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/* Perspective (projective) map taking 4 points onto 4 points: returns h0..h7 (h8 = 1). */
function homography(src: Pt[], dst: Pt[]) {
  const A: number[][] = [];
  src.forEach(([x, y], i) => {
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });
  for (let c = 0; c < 8; c++) { // Gaussian elimination with partial pivoting
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((r, i) => r[8] / r[i]);
}
const hp = (H: number[], x: number, y: number): Pt => { const w = H[6] * x + H[7] * y + 1; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; };
/* Best flat (affine) approximation of the perspective map over one rectangle, as SVG matrix(a b c d e f) numbers. */
function fitAffine(H: number[], x0: number, y0: number, x1: number, y1: number) {
  const P = rectPts([x0, y0, x1, y1]), Q = P.map(([x, y]) => hp(H, x, y));
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, w2 = ((x1 - x0) / 2) ** 2 * 4, h2 = ((y1 - y0) / 2) ** 2 * 4;
  const qx = Q.reduce((s, q) => s + q[0], 0) / 4, qy = Q.reduce((s, q) => s + q[1], 0) / 4;
  let a = 0, b = 0, c = 0, d = 0;
  P.forEach(([x, y], i) => { const dx = x - mx, dy = y - my; a += (Q[i][0] - qx) * dx; c += (Q[i][0] - qx) * dy; b += (Q[i][1] - qy) * dx; d += (Q[i][1] - qy) * dy; });
  a /= w2; c /= h2; b /= w2; d /= h2;
  return [a, b, c, d, qx - a * mx - c * my, qy - b * mx - d * my];
}
const mat = (m: number[]) => `matrix(${m.map((n) => +n.toFixed(5)).join(' ')})`;
// Side-view outlines as point lists (rounded rects sampled along their corners), so they can be mapped into another angle.
function rrPts(x: number, y: number, w: number, h: number, r: number): Pt[] {
  const out: Pt[] = [], C = [[x + w - r, y + r, -90], [x + w - r, y + h - r, 0], [x + r, y + h - r, 90], [x + r, y + r, 180]];
  C.forEach(([cx, cy, a0]) => { for (let i = 0; i <= 6; i++) { const t = (a0 + i * 15) * Math.PI / 180; out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); } });
  return out;
}
const SIDE_SHAPES = { door: rrPts(876, 658, 271, 104, 42), win: [[1161, 345], [1226, 355], [1300, 489], [1199, 489]], badge: rrPts(1016, 677, 113, 56, 20) };
const mapPath = (H: number[], pts: Pt[]) => pts.map(([x, y], i) => { const [u, v] = hp(H, x, y); return (i ? 'L' : 'M') + u.toFixed(1) + ' ' + v.toFixed(1); }).join(' ') + ' Z';
/* Zones of one photo (colour + angle), worked out once. */
const ZCACHE: Record<string, any> = {};
function zoneOf(trim: string, ang: Angle) {
  const key = trim + '-' + ang;
  if (ZCACHE[key]) return ZCACHE[key];
  const base = QS_ZONES[ang], o = ZONE_OVR[key] || base, z: any = { views: base.views };
  if (o.dq && o.wq && o.bq) {
    z.Hd = homography(rectPts(SIDE_R.door), o.dq); z.Hw = homography(rectPts(SIDE_R.win), o.wq); z.Hb = homography(rectPts(SIDE_R.badge), o.bq);
    z.door = mapPath(z.Hd, SIDE_SHAPES.door); z.win = (o as any).win || mapPath(z.Hw, SIDE_SHAPES.win); z.badge = mapPath(z.Hb, SIDE_SHAPES.badge);
    z.dA = fitAffine(z.Hd, 860, 645, 1160, 775); z.wA = fitAffine(z.Hw, 1150, 335, 1310, 500); z.bA = fitAffine(z.Hb, 1016, 677, 1129, 733);
    z.ds = Math.sqrt(Math.abs(z.dA[0] * z.dA[3] - z.dA[1] * z.dA[2])); z.ws = Math.sqrt(Math.abs(z.wA[0] * z.wA[3] - z.wA[1] * z.wA[2]));
  }
  return (ZCACHE[key] = z);
}
/* Draw side-view artwork in perspective. SVG has no perspective transform, so the artwork rectangle is split into a 2×2 grid of
   cells, each cut into 2 triangles; every triangle is drawn (a <use> of one shared copy) with the flat transform that maps its 3
   corners exactly, so neighbouring pieces meet without steps. Triangles are grown by half a pixel so no seam shows. */
const triAffine = (s: Pt[], d: Pt[]) => {
  const [[x0, y0], [x1, y1], [x2, y2]] = s, det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  const solve = (k: number) => { // coefficients p, q, r of k' = p·x + q·y + r
    const v0 = d[0][k], v1 = d[1][k], v2 = d[2][k];
    const p = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det, q = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det;
    return [p, q, v0 - p * x0 - q * y0];
  };
  const X = solve(0), Y = solve(1);
  return [X[0], Y[0], X[1], Y[1], X[2], Y[2]];
};
function warp(id: string, H: number[], [x, y, w, h]: number[], content: string, n = 2) {
  let defs = `<g id="${id}">${content}</g>`, body = '', k = 0;
  const P = (i: number, j: number): Pt => [x + w * i / n, y + h * j / n];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    for (const tri of [[P(i, j), P(i + 1, j), P(i + 1, j + 1)], [P(i, j), P(i + 1, j + 1), P(i, j + 1)]]) {
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3, c = `${id}${k++}`;
      const grown = tri.map(([px, py]) => { const l = Math.hypot(px - cx, py - cy) || 1; return `${(px + (px - cx) / l * .7).toFixed(2)},${(py + (py - cy) / l * .7).toFixed(2)}`; });
      defs += `<clipPath id="${c}"><polygon points="${grown.join(' ')}"/></clipPath>`;
      body += `<g transform="${mat(triAffine(tri, tri.map(([px, py]) => hp(H, px, py))))}" clip-path="url(#${c})"><use href="#${id}"/></g>`;
    }
  }
  return { defs, body };
}
/* Car colour of a version (an unknown one falls back to that version's first) and the photo for it and an angle. */
const trimOf = (m: unknown, t: unknown) => { const L = TRIMS[MOD(m) === MODEL_DEFS.pop ? 'pop' : 'qs']; return typeof t === 'string' && L.includes(t) ? t : L[0]; };
const angleOf = (m: unknown, a: unknown): Angle => (anglesOf(m).includes(a as Angle) ? (a as Angle) : 'side');
const photoURL = (trim: string, ang: Angle) => `${IMG_DIR}ami/${trim}-${ang}.webp`;
const imgOf = (m: unknown, t: unknown, ang: Angle) => (MOD(m) === MODEL_DEFS.qs ? `href="${photoURL(trimOf(m, t), ang)}" width="2000" height="1125"` : MOD(m).img);
const viewsAt = (m: unknown, ang: Angle): Record<string, number[]> => (ang === 'side' ? viewsOf(m) : QS_ZONES[ang].views);

/* ---------- Kit pieces on the car ----------
   Only the stickers in the order are drawn; a zone that is not included shows the car as it left the factory.
   Missing pieces (older carts, the hero) = the full kit. */
const zonesOf = (o: Partial<Cfg>) => {
  const m = MOD(o.model) === MODEL_DEFS.pop ? 'pop' : 'qs', inc = includedPieces({ model: m, pieces: normPieces(o.pieces, m) });
  return { door: inc.includes('door'), win: inc.includes('window'), accent: inc.includes('accent'), rims: inc.includes('rims') };
};
const zonesKey = (o: Partial<Cfg>) => Object.values(zonesOf(o)).join();
/* Rims of each photo: [cx, cy, rx, ry] of the outer rim edge. Side views come from MODEL_DEFS; the ¾ view sees them as ellipses;
   the front and rear views show no rim face. */
const RIMS34: Record<string, number[][]> = {
  front34: [[838.4, 749.5, 72, 75], [1378.7, 706.2, 52, 65]],
  'browncolor-front34': [[926, 756, 80, 86], [1399, 710, 53, 76]],
};
/* Rim sticker: a ring along the outer lip in the first colour with a thin line inside it in the second; two short gaps let the
   drive-in spin show. Drawn around (0, 0); gloss/matte uses the same shine as the other stickers. */
const rimRing = (u: string, rx: number, ry: number, a: string, b: string, shine: string) => {
  const ring = (k: number) => `cx="0" cy="0" rx="${(rx * k).toFixed(1)}" ry="${(ry * k).toFixed(1)}"`, w = (Math.min(rx, ry) * .11).toFixed(1);
  return `<g class="rim-sticker"><ellipse class="rs-a" ${ring(.89)} fill="none" stroke="${a}" stroke-width="${w}" pathLength="100" stroke-dasharray="47 3" stroke-dashoffset="1.5"/>`
    + `<ellipse class="rs-b" ${ring(.79)} fill="none" stroke="${b}" stroke-width="${(Math.min(rx, ry) * .025).toFixed(2)}"/>`
    + `<ellipse class="shine" ${ring(.89)} fill="none" stroke="url(#${u}-sh)" stroke-width="${w}" ${shine}/></g>`;
};

/* ---------- Night (configurator in the dark theme) ----------
   Lamp lenses traced on each photo as [cx, cy, rx, ry]: head = headlights (warm white), tail = rear lights (red).
   pools = light on the road [cx, cy, rx, ry, 0 head | 1 tail]; beams = soft headlight beams [cx, cy, rx, ry, angle°],
   brightest at the lamp end (the end the angle points to); floor = top of the photo's grey floor shadow, darkened at night. */
const NIGHT: Record<string, { head?: number[][]; tail?: number[][]; pools?: number[][]; beams?: number[][]; floor?: number }> = {
  'qs-front': { head: [[817, 563, 23, 23], [1185, 563, 23, 23]], pools: [[815, 905, 170, 30, 0], [1185, 905, 170, 30, 0]] },
  'qs-front34': { head: [[723, 535, 11, 24], [623, 518, 6, 20]], pools: [[560, 872, 210, 30, 0]], beams: [[575, 587, 160, 34, -19], [478, 568, 150, 26, -19]] },
  'browncolor-front34': { head: [[797, 541, 13, 31], [633, 521, 8, 21]], pools: [[590, 878, 220, 30, 0]], beams: [[647, 594, 165, 38, -19], [487, 571, 150, 26, -19]] },
  'qs-side': { head: [[622, 548, 6, 20]], tail: [[1399, 553, 6, 22]], pools: [[470, 848, 190, 16, 0], [1450, 848, 80, 10, 1]], beams: [[452, 556, 175, 40, -3]] },
  'qs-back': { tail: [[1029, 535, 19, 19], [1310, 535, 19, 19]], pools: [[1030, 862, 120, 18, 1], [1305, 862, 120, 18, 1]] },
  'pop-side': { head: [[626, 531, 14, 12]], tail: [[1393, 530, 5, 13]], pools: [[470, 852, 190, 16, 0], [1450, 852, 80, 10, 1]], beams: [[456, 540, 175, 36, -3]], floor: 826 },
};
const nightKey = (o: Partial<Cfg>, ang: Angle) => (MOD(o.model) === MODEL_DEFS.pop ? 'pop-side' : trimOf(o.model, o.trim) === 'browncolor' && ang === 'front34' ? 'browncolor-front34' : 'qs-' + ang);
// Style of the night layers: shown or hidden (hidden ones are not painted at all), with a soft fade unless motion is reduced.
const nightStyle = (on: boolean) => `opacity:${on ? 1 : 0};visibility:${on ? 'visible' : 'hidden'};transition:${reduced() ? 'none' : 'opacity .5s ease,visibility .5s'}`;
/* Night layers of one photo: 'under' (light on the road, drawn below the car) and 'over' (the car slightly darker and bluer,
   then the glowing lamps). Empty unless asked for (live stage, or night: true). */
function nightLayers(u: string, o: CarOpts, ang: Angle, img: string) {
  if (!o.live && !o.night) return { defs: '', under: '', over: '' };
  const N = NIGHT[nightKey(o, ang)] || {}, st = nightStyle(!!o.night), e = (c: number[], f: string) => `<ellipse cx="${c[0]}" cy="${c[1]}" rx="${c[2]}" ry="${c[3]}" fill="${f}"/>`;
  const defs = `<filter id="${u}-nd" color-interpolation-filters="sRGB"><feFlood flood-color="#0A1328" flood-opacity=".42"/><feComposite in2="SourceAlpha" operator="in"/></filter>
    <radialGradient id="${u}-nh"><stop offset="0" stop-color="#FFF4DC" stop-opacity=".75"/><stop offset=".3" stop-color="#FFE2A8" stop-opacity=".28"/><stop offset="1" stop-color="#FFD58A" stop-opacity="0"/></radialGradient>
    <radialGradient id="${u}-nr"><stop offset="0" stop-color="#FF4A36" stop-opacity=".8"/><stop offset=".35" stop-color="#E0180E" stop-opacity=".3"/><stop offset="1" stop-color="#B00A04" stop-opacity="0"/></radialGradient>
    <radialGradient id="${u}-nl"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".65" stop-color="#FFF6E2" stop-opacity=".95"/><stop offset="1" stop-color="#FFE7B8" stop-opacity=".55"/></radialGradient>
    <radialGradient id="${u}-nt"><stop offset="0" stop-color="#FF8A70"/><stop offset=".6" stop-color="#FF2A1C" stop-opacity=".95"/><stop offset="1" stop-color="#D0120A" stop-opacity=".6"/></radialGradient>
    <radialGradient id="${u}-np"><stop offset="0" stop-color="#FFE6B5" stop-opacity=".42"/><stop offset="1" stop-color="#FFE6B5" stop-opacity="0"/></radialGradient>
    <radialGradient id="${u}-nq"><stop offset="0" stop-color="#FF2A1C" stop-opacity=".38"/><stop offset="1" stop-color="#FF2A1C" stop-opacity="0"/></radialGradient>
    <filter id="${u}-nf" color-interpolation-filters="sRGB"><feFlood flood-color="#05070D" flood-opacity=".94"/><feComposite in2="SourceAlpha" operator="in"/></filter>
    <linearGradient id="${u}-ng" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset=".15" stop-color="#fff"/></linearGradient>
    <mask id="${u}-nc" maskUnits="userSpaceOnUse" x="0" y="0" width="2000" height="1300"><rect x="0" y="${(N.floor || 0) - 40}" width="2000" height="300" fill="url(#${u}-ng)"/></mask>
    <radialGradient id="${u}-nb" fx=".96" fy=".5"><stop offset="0" stop-color="#FFEBC2" stop-opacity=".34"/><stop offset=".5" stop-color="#FFEBC2" stop-opacity=".1"/><stop offset="1" stop-color="#FFEBC2" stop-opacity="0"/></radialGradient>`;
  // With a floor shadow in the photo, the light on the road goes over it (it would hide it otherwise).
  const pools = (N.pools || []).map((p) => e(p, `url(#${u}-${p[4] ? 'nq' : 'np'})`)).join('');
  const under = N.floor ? '' : `<g class="night" style="${st}">${pools}</g>`;
  const beams = (N.beams || []).map((B) => `<ellipse cx="${B[0]}" cy="${B[1]}" rx="${B[2]}" ry="${B[3]}" transform="rotate(${B[4]} ${B[0]} ${B[1]})" fill="url(#${u}-nb)"/>`).join('');
  const halo = (L: number[], id: string, k: number) => { const r = Math.max(L[2], L[3]) * k; return e([L[0], L[1], r, r], `url(#${u}-${id})`); };
  const over = `<g class="night" style="${st}"><image ${img} filter="url(#${u}-nd)"/>${N.floor ? `<image ${img} filter="url(#${u}-nf)" mask="url(#${u}-nc)"/>${pools}` : ''}${beams}`
    + (N.head || []).map((L) => halo(L, 'nh', 3.4) + e(L, `url(#${u}-nl)`)).join('')
    + (N.tail || []).map((L) => halo(L, 'nr', 2.6) + e(L, `url(#${u}-nt)`)).join('') + '</g>';
  return { defs, under, over };
}

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

const growPlate = (P: number[]) => [P[0] - 3, P[1] - 3, P[2] + 6, P[3] + 6, P[4] + 3];
const plateText = (o: Partial<Cfg>) => (o.numberOn && o.number ? esc(o.number) : '');

/* Accessible name of a car picture: design, colours (live stage only), Ami version and badge text. */
function carLabel(kit: Kit, o: Cfg, full: boolean, ang: Angle = 'side') {
  const d = kit.D(o.design)!, T = kit.T;
  let s = T('carDesign', { name: d.name });
  if (full) {
    const c1 = kit.COLORS[o.c1], c2 = kit.COLORS[o.c2], finish = T(o.finish === 'gloss' ? 'glossLc' : 'matteLc');
    s += d.fixed || !c1 || !c2 ? T('carInOrig', { finish }) : T('carIn', { c1: c1.name, c2: c2.name, finish });
  }
  s += T('carOn', { model: MOD(o.model).name });
  if (full && ang !== 'side') s += T('carAngle_' + ang);
  if (full && o.numberOn && o.number) s += T('carBadge', { text: o.number });
  return s;
}

interface CarOpts extends Cfg { uid: string; view: string; live?: boolean; decorative?: boolean; angle?: Angle; night?: boolean }
export function carSVG(kit: Kit, o: CarOpts): string {
  const ang = angleOf(o.model, o.angle);
  if (ang !== 'side') return carSVGAt(kit, o, ang);
  const u = o.uid, a = hex(o.c1), b = hex(o.c2), A = ART[o.design] || NO_ART, M = MOD(o.model), V = viewsOf(o.model), v = V[o.view] || V.full, live = !!o.live;
  const img = imgOf(o.model, o.trim, 'side'), Z = zonesOf(o), shine = `style="opacity:${o.finish === 'gloss' ? 1 : .25}"`;
  // Rims: live, a copy of each wheel turns during the drive-in; the rim sticker (if ordered) sits on that turning copy.
  const ring = Z.rims ? rimRing(u, M.rimR, M.rimR, a, b, shine) : '';
  const rims = M.wheels.map(([x, y]: number[]) => (live || ring ? `<g transform="translate(${x} ${y})"><g class="rimspin">${live ? `<g clip-path="url(#${u}-rim)"><image ${img} transform="translate(${-x} ${-y})"/></g>` : ''}${ring}</g></g>` : '')).join('');
  const lights = M.lights && Z.accent ? ((L: any) => `<mask id="${u}-lt" maskUnits="userSpaceOnUse" x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}"><image href="${L.mask}" x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" preserveAspectRatio="none"/></mask><rect class="lights" x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" fill="${a}" mask="url(#${u}-lt)" style="transition:fill .6s"/>`)(M.lights) : '';
  // The brown-with-colour car has a bright green pill in the badge recess: a slightly larger plate keeps it hidden.
  const P = M === MODEL_DEFS.qs && trimOf(o.model, o.trim) === 'browncolor' ? growPlate(M.plate) : M.plate;
  const a11y = o.decorative ? 'aria-hidden="true" focusable="false"' : `role="img" aria-label="${esc(carLabel(kit, o, live))}"`;
  const N = nightLayers(u, o, 'side', img);
  // Door sticker: panel artwork, its shading, the panel lines and the OFS/T badge plate over the factory badge.
  const door = Z.door ? `<g clip-path="url(#${u}-door)">
      <rect x="860" y="645" width="300" height="130" fill="#18191A"/>
      <g class="slot-door"><g>${A.door(a, b, u + 'x')}</g></g>
      <rect x="860" y="645" width="300" height="130" fill="url(#${u}-ds)"/>
      <rect class="shine" x="860" y="645" width="300" height="130" fill="url(#${u}-sh)" ${shine}/>
    </g>
    <rect ${M.door} fill="none" stroke="#0E0F10" stroke-width="2.5"/>
    <path d="M876 741.5 H1147" stroke="#060606" stroke-width="3"/><path d="M880 744.2 H1143" stroke="#fff" stroke-opacity=".07" stroke-width="1"/><path d="M1011.5 743 V762" stroke="#060606" stroke-width="2.5"/>
    <image ${img} clip-path="url(#${u}-badge)"/>
    <rect x="${P[0]}" y="${P[1]}" width="${P[2]}" height="${P[3]}" rx="${P[4]}" fill="url(#${u}-pl)"/><g${M.dx ? ` transform="translate(${M.dx} 0)"` : ''}>
    <mask id="${u}-lg" maskUnits="userSpaceOnUse" x="1050" y="684" width="50" height="44"><image href="${LOGO}" x="1056" y="687" width="37" height="37"/></mask>
    <rect class="plate-logo" x="1050" y="684" width="50" height="44" fill="${a}" mask="url(#${u}-lg)" style="opacity:${plateText(o) ? 0 : 1};transition:opacity .4s"/>
    <text class="plate" x="1074.5" y="711" text-anchor="middle" fill="${a}" style="font:800 15px Archivo,sans-serif;font-stretch:125%;letter-spacing:.06em">${plateText(o)}</text></g>` : '';
  const win = Z.win ? `<g clip-path="url(#${u}-win)"><g${M.winT ? ` transform="${M.winT}"` : ''}>
      <rect x="1150" y="335" width="160" height="165" fill="#1C2022"/>
      <g class="slot-win"><g>${A.win(a, b, u + 'x')}</g></g>
      <rect x="1150" y="335" width="160" height="165" fill="url(#${u}-ws)"/>
      <rect class="shine" x="1150" y="335" width="145" height="165" fill="url(#${u}-sh)" ${shine}/>
    </g></g>
    <path d="${M.win}" fill="none" ${M.winStroke} stroke-linejoin="round"/>` : '';
  const zones = (Z.door ? `<rect ${M.door}/>` : '') + (Z.win ? `<path d="${M.win}"/>` : '');
  return `<svg class="car-svg" viewBox="${v.join(' ')}" xmlns="${NS}" ${a11y}>
  <defs>
    <clipPath id="${u}-door"><rect ${M.door}/></clipPath>
    <clipPath id="${u}-win"><path d="${M.win}"/></clipPath>
    ${zones ? `<clipPath id="${u}-zones">${zones}</clipPath>` : ''}
    <clipPath id="${u}-badge"><rect ${M.badge}/></clipPath>
    <clipPath id="${u}-rim"><circle r="${M.rimR}"/></clipPath>
    <linearGradient id="${u}-ds" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></linearGradient>
    <linearGradient id="${u}-ws" x1="0" y1="0" x2=".5" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
    <linearGradient id="${u}-sh" x1="0" y1="0" x2="1" y2=".4"><stop offset=".25" stop-color="#fff" stop-opacity="0"/><stop offset=".4" stop-color="#fff" stop-opacity=".22"/><stop offset=".47" stop-color="#fff" stop-opacity=".04"/><stop offset=".7" stop-color="#fff" stop-opacity="0"/><stop offset=".78" stop-color="#fff" stop-opacity=".12"/><stop offset=".84" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="${u}-pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#262626"/><stop offset="1" stop-color="#141414"/></linearGradient>
    <linearGradient id="${u}-sq" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    ${N.defs}
  </defs>
  <g class="drive">
    ${N.under}
    <image ${img}/>
    ${lights}
    ${rims}
    ${door}
    ${win}
    ${N.over}
    ${live && zones ? `<g clip-path="url(#${u}-zones)"><rect class="squeegee" x="-10" y="330" width="20" height="440" fill="url(#${u}-sq)"/></g>` : ''}
  </g></svg>`;
}

/* The car from another angle (Ami 2025). Same layers as the side view: the door and rear-window artwork (drawn in side-view
   coordinates) mapped onto the door and window seen in perspective, their shading, the badge recess and the OFS/T plate.
   The front view shows no sticker zone, so it is only the photo (plus the night lights). */
function carSVGAt(kit: Kit, o: CarOpts, ang: Angle): string {
  const u = o.uid, a = hex(o.c1), b = hex(o.c2), A = ART[o.design] || NO_ART, live = !!o.live, img = imgOf(o.model, o.trim, ang);
  const trim = trimOf(o.model, o.trim), z = zoneOf(trim, ang), v = z.views[o.view] || z.views.full, Z = zonesOf(o);
  const a11y = o.decorative ? 'aria-hidden="true" focusable="false"' : `role="img" aria-label="${esc(carLabel(kit, o, live, ang))}"`;
  const head = `<svg class="car-svg" viewBox="${v.join(' ')}" xmlns="${NS}" ${a11y}>`;
  const N = nightLayers(u, o, ang, img);
  if (!z.Hd) return head + `<defs>${N.defs}</defs><g class="drive">${N.under}<image ${img}/>${N.over}</g></svg>`;
  // The plate is drawn a little larger than in the side view so the factory badge (and the green pill) never peeks out at its edge.
  const shine = `style="opacity:${o.finish === 'gloss' ? 1 : .25}"`, P = growPlate(MODEL_DEFS.qs.plate);
  const D = Z.door ? warp(u + '-dw', z.Hd, [860, 645, 300, 130], `<g class="slot-door"><g>${A.door(a, b, u + 'x')}</g></g>`) : { defs: '', body: '' };
  const W = Z.win ? warp(u + '-ww', z.Hw, [1150, 335, 160, 165], `<g class="slot-win"><g>${A.win(a, b, u + 'x')}</g></g>`) : { defs: '', body: '' };
  // Door panel lines of the side view (lower crease and the short upright), mapped as straight lines.
  const line = (x0: number, y0: number, x1: number, y1: number, st: string) => { const p = hp(z.Hd, x0, y0), q2 = hp(z.Hd, x1, y1); return `<path d="M${p[0].toFixed(1)} ${p[1].toFixed(1)} L${q2[0].toFixed(1)} ${q2[1].toFixed(1)}" ${st}/>`; };
  const sw = (n: number) => (n * z.ds).toFixed(2); // stroke widths scale with the door; the outlines keep a minimum so no factory graphic edge shows
  const rims = Z.rims ? (RIMS34[trim + '-' + ang] || RIMS34[ang] || []).map(([x, y, rx, ry]) => `<g transform="translate(${x} ${y})">${rimRing(u, rx, ry, a, b, shine)}</g>`).join('') : '';
  const door = Z.door ? `<g clip-path="url(#${u}-door)">
      <path d="${z.door}" fill="#18191A"/>
      ${D.body}
      <g transform="${mat(z.dA)}"><rect x="860" y="645" width="300" height="130" fill="url(#${u}-ds)"/><rect class="shine" x="860" y="645" width="300" height="130" fill="url(#${u}-sh)" ${shine}/></g>
    </g>
    <path d="${z.door}" fill="none" stroke="#0E0F10" stroke-width="${Math.max(3.2 * z.ds, 2.8).toFixed(2)}" stroke-linejoin="round"/>
    ${line(876, 741.5, 1147, 741.5, `stroke="#060606" stroke-width="${sw(3)}"`)}${line(880, 744.2, 1143, 744.2, `stroke="#fff" stroke-opacity=".07" stroke-width="${sw(1)}"`)}${line(1011.5, 743, 1011.5, 762, `stroke="#060606" stroke-width="${sw(2.5)}"`)}
    <image ${img} clip-path="url(#${u}-badge)"/>
    <g transform="${mat(z.bA)}">
      <rect x="${P[0]}" y="${P[1]}" width="${P[2]}" height="${P[3]}" rx="${P[4]}" fill="url(#${u}-pl)"/>
      <mask id="${u}-lg" maskUnits="userSpaceOnUse" x="1050" y="684" width="50" height="44"><image href="${LOGO}" x="1056" y="687" width="37" height="37"/></mask>
      <rect class="plate-logo" x="1050" y="684" width="50" height="44" fill="${a}" mask="url(#${u}-lg)" style="opacity:${plateText(o) ? 0 : 1};transition:opacity .4s"/>
      <text class="plate" x="1074.5" y="711" text-anchor="middle" fill="${a}" style="font:800 15px Archivo,sans-serif;font-stretch:125%;letter-spacing:.06em">${plateText(o)}</text>
    </g>` : '';
  const win = Z.win ? `<g clip-path="url(#${u}-win)">
      <path d="${z.win}" fill="#1C2022"/>
      ${W.body}
      <g transform="${mat(z.wA)}"><rect x="1150" y="335" width="160" height="165" fill="url(#${u}-ws)"/><rect class="shine" x="1150" y="335" width="145" height="165" fill="url(#${u}-sh)" ${shine}/></g>
    </g>
    <path d="${z.win}" fill="none" stroke="#0A0B0C" stroke-width="${Math.max(4.5 * z.ws, 3).toFixed(2)}" stroke-linejoin="round"/>` : '';
  return `${head}
  <defs>
    <clipPath id="${u}-door"><path d="${z.door}"/></clipPath>
    <clipPath id="${u}-win"><path d="${z.win}"/></clipPath>
    <clipPath id="${u}-badge"><path d="${z.badge}"/></clipPath>
    <linearGradient id="${u}-ds" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></linearGradient>
    <linearGradient id="${u}-ws" x1="0" y1="0" x2=".5" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
    <linearGradient id="${u}-sh" x1="0" y1="0" x2="1" y2=".4"><stop offset=".25" stop-color="#fff" stop-opacity="0"/><stop offset=".4" stop-color="#fff" stop-opacity=".22"/><stop offset=".47" stop-color="#fff" stop-opacity=".04"/><stop offset=".7" stop-color="#fff" stop-opacity="0"/><stop offset=".78" stop-color="#fff" stop-opacity=".12"/><stop offset=".84" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="${u}-pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#262626"/><stop offset="1" stop-color="#141414"/></linearGradient>
    ${D.defs}${W.defs}${N.defs}
  </defs>
  <g class="drive">
    ${N.under}
    <image ${img}/>
    ${rims}
    ${door}
    ${win}
    ${N.over}
  </g></svg>`;
}

/* ---------- Live stage (hero + configurator) ---------- */
const easeIO = (k: number) => (k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
export class Stage {
  host: HTMLElement; kit: Kit; cfg: Cfg; vname = 'full'; ang: Angle = 'side'; pre = false; night = false;
  u = ''; lc = 0; vb: number[] = []; vRaf = 0; dRaf = 0;
  svg: any; slots: any[] = []; sq: any; drive: any; plate: any; logo: any; shines: any[] = []; rims: any[] = []; lights: any[] = []; defs: any;
  constructor(host: HTMLElement, kit: Kit, cfg: Cfg, night = false) { this.host = host; this.kit = kit; this.cfg = { ...cfg }; this.night = night; this.build(); }
  /* (Re)build the SVG for the current config and angle (a different Ami version or car colour needs a different photo), keeping
     the camera view. fade: the old picture stays on top and fades out (angle and car-colour changes). */
  build(fade = false) {
    const cfg = this.cfg;
    cancelAnimationFrame(this.vRaf); cancelAnimationFrame(this.dRaf);
    this.ang = angleOf(cfg.model, this.ang);
    const V = viewsAt(cfg.model, this.ang);
    if (!V[this.vname]) this.vname = 'full';
    this.u = 'st' + (++UID); this.lc = 0; this.vb = V[this.vname].slice();
    const html = carSVG(this.kit, { ...cfg, uid: this.u, view: this.vname, live: true, angle: this.ang, night: this.night });
    qa(':scope > .car-fade', this.host).forEach((el) => el.remove()); // a fade still running from a quick double press
    const old = fade && !reduced() ? this.svg : null;
    if (old && old.parentNode === this.host) {
      if (getComputedStyle(this.host).position === 'static') this.host.style.position = 'relative';
      old.classList.add('car-fade'); old.setAttribute('aria-hidden', 'true');
      Object.assign(old.style, { position: 'absolute', left: '0', top: '0', width: '100%', pointerEvents: 'none' });
      this.host.insertAdjacentHTML('afterbegin', html);
      old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: 'ease-in-out' }).onfinish = () => old.remove();
    } else this.host.innerHTML = html;
    this.svg = this.host.firstElementChild;
    this.slots = [q('.slot-door', this.svg), q('.slot-win', this.svg)]; // null where that piece is not in the kit
    this.sq = q('.squeegee', this.svg); this.drive = q('.drive', this.svg); this.plate = q('.plate', this.svg); this.logo = q('.plate-logo', this.svg);
    this.shines = qa('.shine', this.svg); this.rims = qa('.rimspin', this.svg); this.lights = qa('.lights', this.svg); this.defs = q('defs', this.svg);
  }
  /* The language changed: new accessible name, same picture. */
  setKit(kit: Kit) { this.kit = kit; if (this.svg) this.svg.setAttribute('aria-label', carLabel(kit, this.cfg, true, this.ang)); }
  set(cfg: Cfg) {
    const p = this.cfg; this.cfg = { ...cfg };
    if (!this.kit.D(cfg.design)) return;
    if ((p.model || 'qs') !== (cfg.model || 'qs')) { this.build(); this.driveIn(); this.preload(); return; }
    if (trimOf(p.model, p.trim) !== trimOf(cfg.model, cfg.trim)) { this.build(true); this.preload(); return; }
    if (zonesKey(p) !== zonesKey(cfg)) { this.build(true); return; } // other kit pieces: crossfade to the new set of stickers
    this.svg.setAttribute('aria-label', carLabel(this.kit, cfg, true, this.ang));
    if (p.finish !== cfg.finish) this.shines.forEach((s) => (s.style.opacity = cfg.finish === 'gloss' ? 1 : .25));
    if (p.design !== cfg.design || p.c1 !== cfg.c1 || p.c2 !== cfg.c2) this.wipe();
    // Rim stickers take the new colours directly.
    qa('.rs-a', this.svg).forEach((el) => el.setAttribute('stroke', hex(cfg.c1)));
    qa('.rs-b', this.svg).forEach((el) => el.setAttribute('stroke', hex(cfg.c2)));
    const t = plateText(cfg);
    if (t !== plateText(p) || p.c1 !== cfg.c1) {
      this.lights.forEach((l) => l.setAttribute('fill', hex(cfg.c1)));
      if (!this.plate) return; // front view: no badge
      this.plate.textContent = cfg.numberOn ? cfg.number : '';
      this.plate.setAttribute('fill', hex(cfg.c1));
      this.logo.setAttribute('fill', hex(cfg.c1));
      this.logo.style.opacity = t ? 0 : 1;
      if (!reduced() && t && !plateText(p)) this.plate.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500 });
    }
  }
  /* Turn the car to another camera angle (crossfade), same design and colours, camera back to that angle's full view. */
  angle(name: Angle) {
    const a = angleOf(this.cfg.model, name);
    if (a === this.ang) return;
    this.ang = a; this.vname = 'full'; this.build(true);
  }
  currentAngle() { return this.ang; }
  /* Night scene: headlights and rear lights on, the car a little darker; fades in and out (instant with reduced motion). */
  setNight(on: boolean) {
    on = !!on;
    if (on === this.night) return;
    this.night = on;
    qa('.night', this.svg).forEach((g) => g.setAttribute('style', nightStyle(on)));
  }
  /* Fetch the other angles' photos of this car colour in the background, so turning the car is instant (configurator only). */
  preload(on?: boolean) {
    if (on) this.pre = true;
    if (!this.pre || MOD(this.cfg.model) !== MODEL_DEFS.qs) return;
    const t = trimOf(this.cfg.model, this.cfg.trim);
    anglesOf(this.cfg.model).forEach((a) => { const im = new Image(); im.decoding = 'async'; im.src = photoURL(t, a); });
  }
  wipe() {
    const C = this.cfg, lid = this.u + 'L' + (++this.lc), A = ART[C.design] || NO_ART, sq = this.sq;
    // Only the sticker zones in the kit (none in the front view, or when only rims are ordered).
    const fns = [A.door, A.win], idx = [0, 1].filter((i) => this.slots[i]), slots = idx.map((i) => this.slots[i]);
    if (!slots.length) return;
    const layers = idx.map((n) => { const g = document.createElementNS(NS, 'g'); g.innerHTML = fns[n](hex(C.c1), hex(C.c2), lid + n); return g; });
    if (reduced()) { layers.forEach((g, i) => slots[i].replaceChildren(g)); return; }
    const cp = document.createElementNS(NS, 'clipPath'); cp.id = lid + 'w';
    const r = document.createElementNS(NS, 'rect');
    [['x', 860], ['y', 320], ['height', 460], ['width', 0]].forEach(([k, v]) => r.setAttribute(k as string, String(v)));
    cp.append(r); this.defs.append(cp);
    layers.forEach((g, i) => { g.setAttribute('clip-path', `url(#${cp.id})`); slots[i].append(g); });
    // The squeegee light only exists in the side view; on the other angles the new design just sweeps in.
    const t0 = performance.now(), dur = 900, span = 440; if (sq) sq.style.opacity = 1;
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / dur), w = easeIO(k) * span;
      r.setAttribute('width', w.toFixed(1)); if (sq) sq.setAttribute('transform', `translate(${(860 + w).toFixed(1)} 0)`);
      if (k < 1) { requestAnimationFrame(step); return; }
      layers.forEach((g) => { g.removeAttribute('clip-path'); while (g.previousSibling) g.previousSibling.remove(); });
      cp.remove();
      if (sq && slots[0].lastChild === layers[0]) sq.style.opacity = 0;
    };
    requestAnimationFrame(step);
  }
  /* The car drives in from the right (side view); from the other angles it simply fades in. */
  driveIn() {
    if (reduced()) return;
    const t0 = performance.now(), side = this.ang === 'side', dur = side ? 1500 : 600, dist = 560, R = 97;
    cancelAnimationFrame(this.dRaf);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur), off = side ? dist * (1 - easeOut(k)) : 0;
      this.drive.setAttribute('transform', `translate(${off.toFixed(1)} 0)`);
      this.drive.style.opacity = side ? Math.min(1, k * 3) : easeOut(k);
      const deg = off / R * 180 / Math.PI;
      this.rims.forEach((g) => g.setAttribute('transform', `rotate(${deg.toFixed(2)})`));
      if (k < 1) this.dRaf = requestAnimationFrame(step);
    };
    this.dRaf = requestAnimationFrame(step);
  }
  /* Camera presets. The door and window close-ups exist only in the side view, so the car turns to the side first. */
  view(name: string) {
    if ((name === 'door' || name === 'window') && this.ang !== 'side' && anglesOf(this.cfg.model).length > 1) { this.ang = 'side'; this.vname = 'full'; this.build(true); }
    const V = viewsAt(this.cfg.model, this.ang);
    this.vname = V[name] ? name : 'full';
    this.animateTo(V[this.vname], 800);
  }
  /* Zoom in (f < 1) or out (f > 1) around the middle of what is on screen, never wider than the full car or closer than 30%. */
  zoom(f: number) {
    const full = viewsAt(this.cfg.model, this.ang).full, [x, y, w, h] = this.vb;
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
  zoomed() { return this.vb[2] < viewsAt(this.cfg.model, this.ang).full[2] - 1; }
  /* Keep a camera box inside the full-car frame. */
  clampBox(b: number[]) {
    const f = viewsAt(this.cfg.model, this.ang).full;
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
