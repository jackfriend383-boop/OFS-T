/* OFS/T car renderer: design artwork (ART), carSVG, the live Stage and thumbnails.
   Ported from assets/js/car.js. The SVG is built as a string (fast to render in bulk and shared by the cart, search and admin
   thumbnails, and by the server render of the live car); the Stage updates the live copy imperatively and is wrapped by the
   <CarStage> React component. Every change on the live car is instant (no animation). The Stage never runs on the server. */
import DATA from '../data/designs.json';
import PANEL from '../data/panel.json';
import POP from '../data/pop.json'; // the five Ami Pop photos: sticker zones, camera boxes, wheels, front accent masks (scripts/make-pop.py)
import { TRIMS, SPLIT_TRIM, includedPieces, normPieces, normWinShape, type Cfg, type Kit, type WinShape } from './kit';

const NS = 'http://www.w3.org/2000/svg';
const COLORS = DATA.colors as Record<string, { hex: string }>;
const hex = (k: string) => (COLORS[k] || COLORS[Object.keys(COLORS)[0]]).hex;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c as string] as string));
const q = (s: string, r: ParentNode) => r.querySelector(s) as any;
const qa = (s: string, r: ParentNode) => [...r.querySelectorAll(s)] as any[];

const IMG_DIR = import.meta.env.BASE_URL + 'assets/img/';
let UID = 0;

/* ---------- Helpers ---------- */

/* Design artwork = the final sticker sheet, drawn as a picture (made by scripts/make-art.py from src/data/masters/flame-final-door.jpg,
   or by the admin "Designs" tab for designs added there). size = picture size in source px, pill = the sticker sheet inside it.
   'mask' art is split into black, white (blue), first colour (red) and second colour (green) so the two colours can be recoloured
   (a colour-matrix filter, see toneMatrix); 'rgb' art keeps its own colours. The built-in design is a static file at two widths:
   1000 px for phones and low-memory devices, 1600 px otherwise (cropped to the sticker, so the whole picture is the sheet).
   Designs added in the admin come from the shop's server (src(w) = their picture URL) and are registered at run time (registerArt).
   door = where the sheet sits on the side-view car [x, y, w, h]; win = the part of the sheet shown on the rear window, as fractions
   [x, y, w, h] of the sheet; gaps = the sheet has the thin cut gaps between the panel and the two lower strips ([y, x] as fractions
   of the sheet): the car's panel crease is drawn in them. */
interface ArtSrc { mode: 'mask' | 'rgb'; size: number[]; pill: number[]; src: (w: number) => string; door: number[]; win: number[]; gaps?: { y: number; x: number }; winPop?: { src: (w: number) => string; box: number[] }; winSq?: (w: number) => string }
/* Door sticker zone (side view): the sheet's bounding box maps onto the door rect, grown by 0.75 so the sheet edge sits under the outline. */
const DOOR_BOX = [875.25, 657.25, 272.5, 105.5];
const ART_SIZE = [1946, 706], ART_PILL = [0, 0, 1946, 706];
/* Cut gaps of the final design (centre of the horizontal gap and of the vertical gap between the two strips, as fractions of the sheet). */
const ART_GAPS = { y: 0.8185, x: 0.5013 };
/* Rear window: the right-hand part of the sheet, with the O frame. */
const WIN_CROP = [1000 / 1946, 0, 683 / 1946, 1];
/* Ami Pop rear window: the final artwork (a half ring "C"), warped by scripts/make-art.py onto the Pop's window zone (MODEL_DEFS.pop.win)
   so its outer arc, inner arc and flat edge coincide with the zone. The picture is in photo coordinates; this is its box [x, y, w, h]. */
const WINPOP_BOX = POP.winBox;
/* Ami 2025 square rear-window sticker: the factory one is a rounded square (outer 70 x 70, corner radius 22.8) straddling the glass and the
   C-pillar; side-photo coordinates [x, y, w, h, corner radius]. Our sticker covers the same square completely with a piece of the door
   design (no border): art-flame-sq-*.png (scripts/make-art.py). */
const SQ_OUTER = [1221.1, 381.5, 70.1, 70.1, 22.8];
/* Pictures of designs added in the admin keep the old sheet proportions (2000 x 764). */
const REMOTE_SIZE = [2000, 764], REMOTE_PILL = [0, 0, 2000, 764];
const staticSrc = (name: string, ext: string) => (w: number) => IMG_DIR + `art-${name}-${w}.${ext}`;
const ART_SRC: Record<string, ArtSrc> = {
  flame: { mode: 'mask', size: ART_SIZE, pill: ART_PILL, src: staticSrc('flame', 'png'), door: DOOR_BOX, win: WIN_CROP, gaps: ART_GAPS, winPop: { src: staticSrc('flame-win', 'png'), box: WINPOP_BOX }, winSq: staticSrc('flame-sq', 'png') },
};
const NO_ART = { door: (..._a: any[]) => '', win: (..._a: any[]) => '' };

/* ---------- Car photo + sticker zones (coordinates in the 2000×1125 photo) ---------- */
const IMG = IMG_DIR + 'ami-side.webp';
const DOOR_RECT = 'x="876" y="658" width="271" height="104" rx="42"';
const WIN = 'M1161 345 L1226 355 L1300 489 L1199 489 Z';
const VIEWS: Record<string, number[]> = { full: [530, 250, 1080, 646], door: [826, 598, 372, 222], window: [1078, 327, 306, 183], thumb: [556, 272, 1032, 594] };
/* Ami versions. The Ami 2025 is the default everywhere; the Pop is offered in the configurator. The Pop photo is scaled and
   as large as the Ami 2025 on screen; its door sticker zone is the (wider) Pop door zone, so the sheet is moved onto it (doorT); its
   rear-window zone is the small orange half ring (its own artwork, winPop); the front accent strips (lights mask) take the first colour. */
const POP_PHOTO = (ang: string) => IMG_DIR + 'ami/pop-' + ang + '.webp';
const POPD = POP.door;
/* The sheet is drawn in Ami 2025 coordinates (DOOR_BOX); on the Pop it is moved onto the Pop's door zone. */
const POP_DOOR_T = `translate(${POPD[0]} ${POPD[1]}) scale(${(POPD[2] / 271).toFixed(5)} ${(POPD[3] / 104).toFixed(5)}) translate(-876 -658)`;
const popLights = (ang: string) => { const L = (POP.lights as Record<string, any>)[ang]; return L ? { x: L.x, y: L.y, w: L.w, h: L.h, mask: IMG_DIR + L.mask } : undefined; };
const MODEL_DEFS: Record<string, any> = {
  qs: {
    name: 'Ami 2025', img: `href="${IMG}" width="2000" height="1125"`,
    door: DOOR_RECT, win: WIN, winT: '', winStroke: 'stroke="#0A0B0C" stroke-width="3"',
    badge: 'x="1016" y="677" width="113" height="56" rx="20"', plate: [1027, 687, 95, 38, 11], dx: 0,
    /* Wheels for the roll-in: rim centres and radius (the rim edge, measured on the photos: the four car colours share them),
       and the rolling radius of the tyre (centre to ground). */
    wheels: [[697.6, 748.8], [1326.8, 749.3]], rimR: 67, tyreR: 96,
  },
  pop: {
    name: 'Ami Pop', img: `href="${POP_PHOTO('side')}" width="2000" height="1125"`,
    door: `x="${POPD[0]}" y="${POPD[1]}" width="${POPD[2]}" height="${POPD[3]}" rx="${POPD[4]}"`, doorT: POP_DOOR_T, win: POP.win, winT: 'translate(1281.8 420.9) scale(0.605) translate(-1230.5 -417)', // winT only places the Ami 2025 window crop of designs that have no Pop window picture
    winStroke: 'stroke="#0A0B0C" stroke-opacity=".55" stroke-width="1.2"',
    lights: popLights('side'),
    badge: 'x="1016" y="677" width="113" height="56" rx="20"', plate: [1027, 687, 95, 38, 11], dx: 0,
    wheels: POP.wheels, rimR: POP.rimR, tyreR: POP.tyreR,
    /* Camera boxes of the side photo (scripts/make-pop.py): the car (shadow included) centred, drawn as large as the Ami 2025 is. */
    views: POP.views.side,
  },
};
const MOD = (m: unknown) => (typeof m === 'string' && Object.prototype.hasOwnProperty.call(MODEL_DEFS, m) ? MODEL_DEFS[m] : MODEL_DEFS.qs);
const viewsOf = (m: unknown): Record<string, number[]> => MOD(m).views || VIEWS;

/* ---------- Camera angles (Ami 2025) ----------
   Photos: assets/img/ami/<car colour>-<angle>.webp, all 2000×1125 and lined up with the side photo's car. The side view keeps the
   coordinates above. For the ¾ views each sticker zone is the side zone seen in perspective: its 4 corners (TL, TR, BR, BL) are
   traced on the photo (dq door, wq rear window, bq badge), and side-view artwork is mapped onto them (see warp()).
   The Ami 2025's front view shows no sticker zone. The Ami Pop has five photos (assets/img/ami/pop-<angle>.webp, zones in data/pop.json) and
   shows its stickers in all of them: 'back34' is the extra rear-side angle only the Pop has. */
export type Angle = 'front' | 'front34' | 'side' | 'back34' | 'back';
const QS_ANGLES: Angle[] = ['front', 'front34', 'side', 'back'];
const POP_ANGLES: Angle[] = ['front', 'front34', 'side', 'back34', 'back'];
export const anglesOf = (m: unknown): Angle[] => (MOD(m) === MODEL_DEFS.qs ? QS_ANGLES.slice() : POP_ANGLES.slice());
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
const SIDE_SHAPES = { door: rrPts(876, 658, 271, 104, 42), win: [[1161, 345], [1226, 355], [1300, 489], [1199, 489]], badge: rrPts(1016, 677, 113, 56, 20), sq: rrPts(SQ_OUTER[0], SQ_OUTER[1], SQ_OUTER[2], SQ_OUTER[3], SQ_OUTER[4]) };
/* What each version needs to map its side-view artwork into another angle. The artwork is drawn in Ami 2025 coordinates (the door sheet;
   the window crop) except the Pop's window, which has its own picture in side-photo coordinates, so each entry says which rectangle the
   artwork lives in (docR, winR), the box warped (docBox, winBox) and the outlines of the zones (in the same coordinates). */
const popWinPts: Pt[] = (POP.win.match(/-?[\d.]+ -?[\d.]+/g) || []).map((t: string) => t.split(' ').map(Number));
const WB = POP.winBox;
const ZSRC = {
  qs: { docR: SIDE_R.door, winR: SIDE_R.win, badgeR: SIDE_R.badge, doorShape: SIDE_SHAPES.door, winShape: SIDE_SHAPES.win, docBox: [860, 645, 300, 130], winBox: [1150, 335, 160, 165] },
  pop: { docR: SIDE_R.door, winR: [WB[0], WB[1], WB[0] + WB[2], WB[1] + WB[3]], badgeR: undefined as number[] | undefined, doorShape: SIDE_SHAPES.door, winShape: popWinPts, docBox: [860, 645, 300, 130], winBox: WB },
};
const mapPath = (H: number[], pts: Pt[]) => pts.map(([x, y], i) => { const [u, v] = hp(H, x, y); return (i ? 'L' : 'M') + u.toFixed(1) + ' ' + v.toFixed(1); }).join(' ') + ' Z';
/* Zones of one photo (version + colour + angle), worked out once. */
const ZCACHE: Record<string, any> = {};
const popAngle = (ang: Angle) => (POP.zones as Record<string, any>)[ang];
function zoneOf(model: 'qs' | 'pop', trim: string, ang: Angle) {
  const key = model + trim + '-' + ang;
  if (ZCACHE[key]) return ZCACHE[key];
  const S = ZSRC[model], z: any = { views: model === 'pop' ? (POP.views as Record<string, any>)[ang] : QS_ZONES[ang].views, src: S };
  const o: { dq?: Pt[]; wq?: Pt[]; bq?: Pt[] } = model === 'pop' ? (popAngle(ang) || {}) : QS_ZONES[ang];
  if (o.dq && o.wq) {
    z.Hd = homography(rectPts(S.docR), o.dq); z.Hw = homography(rectPts(S.winR), o.wq);
    z.door = mapPath(z.Hd, S.doorShape); z.win = mapPath(z.Hw, S.winShape);
    z.dA = fitAffine(z.Hd, S.docBox[0], S.docBox[1], S.docBox[0] + S.docBox[2], S.docBox[1] + S.docBox[3]);
    z.wA = fitAffine(z.Hw, S.winBox[0], S.winBox[1], S.winBox[0] + S.winBox[2], S.winBox[1] + S.winBox[3]);
    z.ds = Math.sqrt(Math.abs(z.dA[0] * z.dA[3] - z.dA[1] * z.dA[2])); z.ws = Math.sqrt(Math.abs(z.wA[0] * z.wA[3] - z.wA[1] * z.wA[2]));
    if (model === 'qs') z.sq = mapPath(z.Hw, SIDE_SHAPES.sq); // the square sticker, in perspective
    if (o.bq && S.badgeR) { z.Hb = homography(rectPts(S.badgeR), o.bq); z.badge = mapPath(z.Hb, SIDE_SHAPES.badge); }
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
/* Slower devices (html.lite, set by theme-init.js): 1x1 grid = 2 triangles per sticker zone instead of 8, so each sticker is
   repainted 2 times instead of 8 in the angled views. The perspective is a little less exact. Never used by the server render. */
const WARP_N = typeof document !== 'undefined' && document.documentElement.classList.contains('lite') ? 1 : 2;
function warp(id: string, H: number[], [x, y, w, h]: number[], content: string, n = WARP_N) {
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
const trimOf = (m: unknown, t: unknown) => { const pop = MOD(m) === MODEL_DEFS.pop, L = TRIMS[pop ? 'pop' : 'qs']; return typeof t === 'string' && (L.includes(t) || (!pop && t === SPLIT_TRIM)) ? t : L[0]; };
const angleOf = (m: unknown, a: unknown): Angle => (anglesOf(m).includes(a as Angle) ? (a as Angle) : 'side');
/* The split car (home page model box): front half black (this trim), back half brown, cut straight down the middle of the door
   (x 1011.5), so the car is half and half; the door sticker is drawn whole over both halves and the black car's factory graphics
   behind the cut never show. Every other angle shows the black car. */
const SPLIT_FRONT = 'yellow', SPLIT_BACK = 'brown';
const SPLIT_X = 1011.5; // middle of the door panel (door x 815..1207 in the photo; the sticker x 876..1147)
/* Front-half mask: a clean vertical cut down the middle of the door (3 px feather), widened below the sills (y >= 788) so the black
   photo's darker floor shadow fades into the brown one's instead of leaving a vertical edge under the car. */
const SPLIT_MASK = (() => {
  const g = (id: string, w: number) => `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${SPLIT_X - w}" x2="${SPLIT_X + w}" y1="0" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>`;
  return `${g('ofst-sg1', 1.5)}${g('ofst-sg2', 45)}<mask id="ofst-split" maskUnits="userSpaceOnUse" x="0" y="0" width="2000" height="1125"><rect x="0" y="0" width="2000" height="788" fill="url(#ofst-sg1)"/><rect x="0" y="788" width="2000" height="337" fill="url(#ofst-sg2)"/></mask>`;
})();
const isSplit = (m: unknown, t: unknown) => MOD(m) === MODEL_DEFS.qs && t === SPLIT_TRIM;
const photoTrim = (t: string) => (t === SPLIT_TRIM ? SPLIT_FRONT : t === 'base' ? 'pop' : t); // the real photo set behind a trim code ('base' = the Pop's)
const photoURL = (trim: string, ang: Angle) => `${IMG_DIR}ami/${photoTrim(trim)}-${ang}.webp`;
const imgOf = (m: unknown, t: unknown, ang: Angle) => `href="${photoURL(trimOf(m, t), ang)}" width="2000" height="1125"`;
/* The car photo as markup, with extra attributes (a night filter) on every <image>. The split car stacks two photos: the brown one
   whole, the black one clipped by SPLIT_CUT (the clip path has a fixed id: every copy is identical, so duplicates are harmless). */
const photoTag = (m: unknown, t: unknown, ang: Angle, attrs = '') => {
  if (ang === 'side' && isSplit(m, trimOf(m, t))) {
    const w = 'width="2000" height="1125"';
    return `${SPLIT_MASK}<image href="${photoURL(SPLIT_BACK, 'side')}" ${w} ${attrs}/><g mask="url(#ofst-split)"><image href="${photoURL(SPLIT_FRONT, 'side')}" ${w} ${attrs}/></g>`;
  }
  return `<image ${imgOf(m, t, ang)} ${attrs}/>`;
};
const viewsAt = (m: unknown, ang: Angle): Record<string, number[]> => (ang === 'side' ? viewsOf(m) : MOD(m) === MODEL_DEFS.pop ? (POP.views as Record<string, any>)[ang] : QS_ZONES[ang].views);

/* ---------- Kit pieces on the car ----------
   Only the stickers in the order are drawn; a zone that is not included shows the car as it left the factory.
   Missing pieces (older carts, the hero) = the full kit. */
const zonesOf = (o: Partial<Cfg>) => {
  const m = MOD(o.model) === MODEL_DEFS.pop ? 'pop' : 'qs', inc = includedPieces({ model: m, pieces: normPieces(o.pieces, m) });
  return { door: inc.includes('door'), win: inc.includes('window'), accent: inc.includes('accent') };
};
const winShapeOf = (o: Partial<Cfg>): WinShape => normWinShape(o.winShape, MOD(o.model) === MODEL_DEFS.pop ? 'pop' : 'qs');
const zonesKey = (o: Partial<Cfg>) => Object.values(zonesOf(o)).join() + '|' + winShapeOf(o);

/* Colour of the bare door panel (what shows in the gap of the sticker): sampled from the photo around the door, per car colour and angle (scripts/make-panel.py). */
const panelOf = (m: unknown, t: unknown, ang: Angle): string => { const P = PANEL as Record<string, string>; return (MOD(m) === MODEL_DEFS.qs ? P[photoTrim(trimOf(m, t)) + '-' + ang] : (POP.panel as Record<string, string>)[ang]) || '#18191A'; };

/* ---------- Night (configurator in the dark theme) ----------
   Lamp lenses traced on each photo as [cx, cy, rx, ry]: head = headlights (warm white), tail = rear lights (red).
   pools = light on the road [cx, cy, rx, ry, 0 head | 1 tail]; beams = soft headlight beams [cx, cy, rx, ry, angle°],
   brightest at the lamp end (the end the angle points to); floor = top of the photo's grey floor shadow, darkened at night. */
const NIGHT: Record<string, { head?: number[][]; tail?: number[][]; pools?: number[][]; beams?: number[][]; floor?: number }> = {
  'qs-front': { head: [[817, 563, 23, 23], [1185, 563, 23, 23]], pools: [[815, 905, 170, 30, 0], [1185, 905, 170, 30, 0]] },
  'qs-front34': { head: [[723, 535, 11, 24], [623, 518, 6, 20]], pools: [[560, 872, 210, 30, 0]], beams: [[575, 587, 160, 34, -19], [478, 568, 150, 26, -19]] },
  'qs-side': { head: [[626, 526, 6, 15]], tail: [[1398, 524, 6, 17]], pools: [[470, 848, 190, 16, 0], [1450, 848, 80, 10, 1]], beams: [[452, 556, 175, 40, -3]] },
  'qs-back': { tail: [[1025, 535, 19, 19], [1302, 532.5, 17, 19]], pools: [[1030, 862, 120, 18, 1], [1305, 862, 120, 18, 1]] },
  'pop-side': { head: [[585, 549, 15, 13]], tail: [[1417, 548, 5.5, 14]], pools: [[416, 897, 206, 17, 0], [1479, 897, 87, 11, 1]], beams: [[400, 558, 190, 39, -3]], floor: 869 },
  'pop-front34': { head: [[545, 647, 6, 12], [728, 655, 9, 15]], pools: [[470, 905, 190, 24, 0]], beams: [[450, 650, 170, 34, -19]] },
  'pop-front': { head: [[619, 652, 10, 18], [892, 666, 15, 21]], pools: [[740, 915, 230, 28, 0]] },
  'pop-back34': { tail: [[1347, 637, 8, 26]], pools: [[1360, 905, 130, 18, 1]] },
  'pop-back': { tail: [[1217.5, 635.3, 15.5, 23], [1431.5, 632.3, 13.5, 20.5]], pools: [[1320, 905, 190, 22, 1]] },
};
const nightKey = (o: Partial<Cfg>, ang: Angle) => (MOD(o.model) === MODEL_DEFS.pop ? 'pop-' : 'qs-') + ang;
/* Night layers of one photo: 'under' (light on the road, drawn below the car) and 'over' (the car slightly darker and bluer,
   then the glowing lamps). Only built when the night scene is on (the live stage rebuilds its picture when it switches), so the
   day picture carries no hidden extra copy of the photo. */
function nightLayers(u: string, o: CarOpts, ang: Angle, photo: (attrs: string) => string) {
  if (!o.night) return { defs: '', under: '', over: '' };
  const N = NIGHT[nightKey(o, ang)] || {}, e = (c: number[], f: string) => `<ellipse cx="${c[0]}" cy="${c[1]}" rx="${c[2]}" ry="${c[3]}" fill="${f}"/>`;
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
  const under = N.floor ? '' : `<g class="night">${pools}</g>`;
  const beams = (N.beams || []).map((B) => `<ellipse cx="${B[0]}" cy="${B[1]}" rx="${B[2]}" ry="${B[3]}" transform="rotate(${B[4]} ${B[0]} ${B[1]})" fill="url(#${u}-nb)"/>`).join('');
  const halo = (L: number[], id: string, k: number) => { const r = Math.max(L[2], L[3]) * k; return e([L[0], L[1], r, r], `url(#${u}-${id})`); };
  const over = `<g class="night">${photo(`filter="url(#${u}-nd)"`)}${N.floor ? `${photo(`filter="url(#${u}-nf)" mask="url(#${u}-nc)"`)}${pools}` : ''}${beams}`
    + (N.head || []).map((L) => halo(L, 'nh', 3.4) + e(L, `url(#${u}-nl)`)).join('')
    + (N.tail || []).map((L) => halo(L, 'nr', 2.6) + e(L, `url(#${u}-nt)`)).join('') + '</g>';
  return { defs, under, over };
}

/* Each design draws into the door panel and the rear window; everything is clipped to those two shapes.
   door(a, b, u) = the whole sheet on the door; win(a, b, u, shape) = a part of the sheet on the rear window ('square' = a rounded square
   in the middle of the glass, the rest of the glass stays bare; any other shape = the whole glass / half ring).
   gapAt = side-view position of the sheet's cut gaps (the horizontal one and the one between the two strips), when the sheet has them. */
export const ART: Record<string, { door: (a: string, b: string, u: string) => string; win: (a: string, b: string, u: string, shape?: WinShape) => string; winPop?: (a: string, b: string, u: string) => string; gapAt?: { y: number; x: number } }> = {};

/* The artwork picture size follows the device: 1000 px files on small screens / low memory, 1600 px otherwise (the server render uses the
   small one). The SVG works in source px, so the file size never changes the layout. The file only downloads when a car with
   a design is actually drawn (thumbnails are drawn when they come near the screen). */
const ART_W = (() => {
  if (typeof window === 'undefined') return 1000;
  const small = typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
  const lowMem = (navigator as any).deviceMemory && (navigator as any).deviceMemory <= 4;
  return small || lowMem ? 1000 : 1600;
})();
const toneMatrix = (a: string, b: string) => {
  const p = (h: string) => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4));
  const L = p(a), Dk = p(b);
  return [0, 1, 2].map((ch) => `${L[ch]} ${Dk[ch]} 1 0 0`).join(' ') + ' 0 0 0 1 0';
};
/* Rear window of the side view (bounding box of the glass); the square sticker on it is SQ_OUTER. */
const WIN_BOX = [1161, 345, 139, 144];
/* Draws a design's picture into the door panel (whole sheet) and the rear window (a part of the same sheet). */
export function registerArt(id: string, S: ArtSrc) {
  const [l, t, r, b] = S.pill, sw = r - l, sh = b - t;
  const art = (box: number[], vb: number[], a: string, bb: string, u: string) => {
    const filt = S.mode === 'mask' ? `<filter id="${u}-tone" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${toneMatrix(a, bb)}"/></filter>` : '';
    return `${filt}<svg x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}" viewBox="${vb.join(' ')}" preserveAspectRatio="none" overflow="hidden">
      <image href="${S.src(ART_W)}" width="${S.size[0]}" height="${S.size[1]}"${filt ? ` filter="url(#${u}-tone)"` : ''}/></svg>`;
  };
  const winVB = [l + S.win[0] * sw, t + S.win[1] * sh, S.win[2] * sw, S.win[3] * sh];
  ART[id] = {
    door: (a, bb, u) => art(S.door, [l, t, sw, sh], a, bb, u + 'd'),
    win: (a, bb, u, shape) => shape === 'square'
      ? (S.winSq
        // the square sticker's own picture: a piece of the door design in both colours (scripts/make-art.py)
        ? `<filter id="${u}sq-tone" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${toneMatrix(a, bb)}"/></filter>`
          + `<image href="${S.winSq(ART_W)}" x="${SQ_OUTER[0]}" y="${SQ_OUTER[1]}" width="${SQ_OUTER[2]}" height="${SQ_OUTER[3]}" preserveAspectRatio="none" filter="url(#${u}sq-tone)"/>`
        : `<clipPath id="${u}wc"><rect x="${SQ_OUTER[0]}" y="${SQ_OUTER[1]}" width="${SQ_OUTER[2]}" height="${SQ_OUTER[3]}" rx="${SQ_OUTER[4]}"/></clipPath><g clip-path="url(#${u}wc)">${art([SQ_OUTER[0], SQ_OUTER[1], SQ_OUTER[2], SQ_OUTER[3]], winVB, a, bb, u + 'w')}</g>`)
      : art(WIN_BOX, winVB, a, bb, u + 'w'),
    gapAt: S.gaps ? { y: S.door[1] + S.gaps.y * S.door[3], x: S.door[0] + S.gaps.x * S.door[2] } : undefined,
    winPop: S.winPop ? (a, bb, u) => {
      const [x, y, w, h] = S.winPop!.box, id = u + 'p';
      return `<filter id="${id}-tone" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${toneMatrix(a, bb)}"/></filter>`
        + `<image href="${S.winPop!.src(ART_W)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none" filter="url(#${id}-tone)"/>`;
    } : undefined,
  };
}
/* The rear-window artwork of a car: the Pop has its own picture (when the design has one), made for its window zone; otherwise the
   sheet's crop, scaled into the zone by the model's winT. */
function winArt(model: unknown, A: typeof ART[string], a: string, b: string, u: string, shape?: WinShape) {
  const M = MOD(model);
  if (M === MODEL_DEFS.pop && A.winPop) return A.winPop(a, b, u);
  return M.winT ? `<g transform="${M.winT}">${A.win(a, b, u, shape)}</g>` : A.win(a, b, u, shape);
}
/* Built-in designs (designs.json "art" names one of ART_SRC). */
(DATA.designs as any[]).forEach((d) => { if (d.art && ART_SRC[d.art]) registerArt(d.id, ART_SRC[d.art]); });
/* A design added in the admin: its preview pictures live on the shop's server and are passed in as ready-to-use blob: addresses
   (the page's security policy only lets images load from itself, data: and blob:). They keep the old sheet proportions. */
export function registerRemoteArt(id: string, mode: 'mask' | 'rgb', urls: { 1000: string; 1600: string }) {
  registerArt(id, { mode, size: REMOTE_SIZE, pill: REMOTE_PILL, src: (w) => (w >= 1600 ? urls[1600] : urls[1000]), door: [872, 654, 279, 112], win: [370 / 2000, 8 / 764, 650 / 2000, 748 / 764] });
}
export { ART_W };
const plateText = (o: Partial<Cfg>) => (o.numberOn && o.number ? esc(o.number) : '');

/* Accessible name of a car picture: design, colours (live stage only), Ami version and badge text. */
function carLabel(kit: Kit, o: Cfg, full: boolean, ang: Angle = 'side') {
  const d = kit.D(o.design)!, T = kit.T;
  let s = T('carDesign', { name: d.name });
  if (full) {
    const c1 = kit.COLORS[o.c1], c2 = kit.COLORS[o.c2];
    s += d.fixed || !c1 || !c2 ? T('carInOrig') : T('carIn', { c1: c1.name, c2: c2.name });
  }
  s += T('carOn', { model: MOD(o.model).name });
  if (full && ang !== 'side') s += T('carAngle_' + ang);
  if (full && o.numberOn && o.number) s += T('carBadge', { text: o.number });
  return s;
}

interface CarOpts extends Cfg { uid: string; view: string; live?: boolean; decorative?: boolean; angle?: Angle; night?: boolean }
/* The front accent strips of a photo, recoloured with the first colour: a rectangle of that colour seen through the strips' mask (Pop only). */
const lightsTag = (u: string, L: { x: number; y: number; w: number; h: number; mask: string } | undefined, fill: string, on: boolean) => (L && on
  ? `<mask id="${u}-lt" maskUnits="userSpaceOnUse" x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}"><image href="${L.mask}" x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" preserveAspectRatio="none"/></mask><rect class="lights" x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" fill="${fill}" mask="url(#${u}-lt)"/>`
  : '');
/* The body seam (glass / C-pillar) that splits the factory square sticker, in side-photo coordinates: the glass's slanted rear edge. */
const SEAM = [[1229, 355], [1303, 489]];
const SQ_SHAPE = `x="${SQ_OUTER[0]}" y="${SQ_OUTER[1]}" width="${SQ_OUTER[2]}" height="${SQ_OUTER[3]}" rx="${SQ_OUTER[4]}"`;
export function carSVG(kit: Kit, o: CarOpts): string {
  const ang = angleOf(o.model, o.angle);
  if (ang !== 'side') return carSVGAt(kit, o, ang);
  const u = o.uid, a = hex(o.c1), b = hex(o.c2), A = ART[o.design] || NO_ART, M = MOD(o.model), V = viewsOf(o.model), v = V[o.view] || V.full, live = !!o.live;
  const photo = (attrs = '') => photoTag(o.model, o.trim, 'side', attrs), Z = zonesOf(o), shine = `style="opacity:.25"`, shape = winShapeOf(o);
  const sq = M === MODEL_DEFS.qs && shape === 'square'; // square rear-window sticker: only the square is drawn, the rest of the glass stays bare
  const lights = lightsTag(u, M.lights, a, Z.accent);
  const a11y = o.decorative ? 'aria-hidden="true" focusable="false"' : `role="img" aria-label="${esc(carLabel(kit, o, live))}"`;
  const N = nightLayers(u, o, 'side', photo);
  // Door sticker: the sheet on the panel (the cut gaps between its parts show the bare panel), its shading and the panel creases in the gaps.
  // The sheet is drawn in Ami 2025 coordinates; the Pop moves it onto its own door zone (doorT).
  const G = A.gapAt, gw = 1.7, dT = M.doorT ? ` transform="${M.doorT}"` : '';
  const door = Z.door ? `<g clip-path="url(#${u}-door)"><g${dT}>
      <rect x="860" y="645" width="300" height="130" fill="${panelOf(o.model, o.trim, 'side')}"/>
      <g class="slot-door"><g>${A.door(a, b, u + 'x')}</g></g>
      <rect x="860" y="645" width="300" height="130" fill="url(#${u}-ds)"/>
      <rect class="shine" x="860" y="645" width="300" height="130" fill="url(#${u}-sh)" ${shine}/>
    </g></g>
    <rect ${M.door} fill="none" stroke="#0E0F10" stroke-width="2.5"/>${G ? `<g${dT}>
    <path d="M876 ${G.y.toFixed(1)} H1147" stroke="#060606" stroke-opacity=".8" stroke-width="${gw}"/><path d="M${G.x.toFixed(1)} ${(G.y + 1.5).toFixed(1)} V762" stroke="#060606" stroke-opacity=".8" stroke-width="1.4"/></g>` : ''}` : '';
  const wT = M.winT ? ` transform="${M.winT}"` : '';
  const win = Z.win ? `<g clip-path="url(#${u}-win)">
      ${sq ? '' : `<g${wT}><rect x="1150" y="335" width="160" height="165" fill="#1C2022"/></g>`}
      <g class="slot-win"><g>${winArt(o.model, A, a, b, u + 'x', shape)}</g></g>
      ${sq ? `<path d="M${SEAM[0].join(' ')} L${SEAM[1].join(' ')}" stroke="#0A0B0C" stroke-width="2.4" stroke-linecap="butt"/>` : ''}
      <g${wT}><rect x="1150" y="335" width="160" height="165" fill="url(#${u}-ws)"/>
      <rect class="shine" x="1150" y="335" width="145" height="165" fill="url(#${u}-sh)" ${shine}/></g>
    </g>${sq ? '' : `
    <path d="${M.win}" fill="none" ${M.winStroke} stroke-linejoin="round"/>`}` : '';
  return `<svg class="car-svg" viewBox="${v.join(' ')}" xmlns="${NS}" ${a11y}>
  <defs>
    <clipPath id="${u}-door"><rect ${M.door}/></clipPath>
    <clipPath id="${u}-win">${sq ? `<rect ${SQ_SHAPE}/>` : `<path d="${M.win}"/>`}</clipPath>
    <clipPath id="${u}-badge"><rect ${M.badge}/></clipPath>
    <linearGradient id="${u}-ds" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></linearGradient>
    <linearGradient id="${u}-ws" x1="0" y1="0" x2=".5" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
    <linearGradient id="${u}-sh" x1="0" y1="0" x2="1" y2=".4"><stop offset=".25" stop-color="#fff" stop-opacity="0"/><stop offset=".4" stop-color="#fff" stop-opacity=".22"/><stop offset=".47" stop-color="#fff" stop-opacity=".04"/><stop offset=".7" stop-color="#fff" stop-opacity="0"/><stop offset=".78" stop-color="#fff" stop-opacity=".12"/><stop offset=".84" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="${u}-pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#262626"/><stop offset="1" stop-color="#141414"/></linearGradient>
    ${N.defs}
  </defs>
  <g>
    ${N.under}
    ${photo()}
    ${lights}
    ${door}
    ${win}
    ${N.over}
  </g></svg>`;
}

/* The car from another angle. Same layers as the side view: the door and rear-window artwork (drawn in side-view coordinates) mapped
   onto the door and window seen in perspective, and their shading. The Ami 2025's front view shows no sticker zone, so it is only the
   photo (plus the night lights); the Pop shows its stickers in all five photos. */
function carSVGAt(kit: Kit, o: CarOpts, ang: Angle): string {
  const u = o.uid, a = hex(o.c1), b = hex(o.c2), A = ART[o.design] || NO_ART, live = !!o.live, photo = (attrs = '') => photoTag(o.model, o.trim, ang, attrs);
  const model = MOD(o.model) === MODEL_DEFS.pop ? 'pop' : 'qs';
  const trim = photoTrim(trimOf(o.model, o.trim)), z = zoneOf(model, trim, ang), v = z.views[o.view] || z.views.full, Z = zonesOf(o);
  const a11y = o.decorative ? 'aria-hidden="true" focusable="false"' : `role="img" aria-label="${esc(carLabel(kit, o, live, ang))}"`;
  const head = `<svg class="car-svg" viewBox="${v.join(' ')}" xmlns="${NS}" ${a11y}>`;
  const N = nightLayers(u, o, ang, photo);
  if (!z.Hd) return head + `<defs>${N.defs}</defs><g>${N.under}${photo()}${N.over}</g></svg>`;
  const S = z.src, shape = winShapeOf(o), sq = model === 'qs' && shape === 'square';
  const shine = `style="opacity:.25"`;
  const lights = lightsTag(u, model === 'pop' ? popLights(ang) : undefined, a, Z.accent);
  const D = Z.door ? warp(u + '-dw', z.Hd, S.docBox, `<g class="slot-door"><g>${A.door(a, b, u + 'x')}</g></g>`) : { defs: '', body: '' };
  const W = Z.win ? warp(u + '-ww', z.Hw, S.winBox, `<g class="slot-win"><g>${winArt(o.model, A, a, b, u + 'x', shape)}</g></g>`) : { defs: '', body: '' };
  // Door panel creases of the side view (in the cut gaps of the sheet), mapped as straight lines.
  const line = (x0: number, y0: number, x1: number, y1: number, st: string) => { const p = hp(z.Hd, x0, y0), q2 = hp(z.Hd, x1, y1); return `<path d="M${p[0].toFixed(1)} ${p[1].toFixed(1)} L${q2[0].toFixed(1)} ${q2[1].toFixed(1)}" ${st}/>`; };
  const sw = (n: number) => (n * z.ds).toFixed(2); // stroke widths scale with the door; the outlines keep a minimum so no factory graphic edge shows
  const G = A.gapAt, wb = S.winBox, winZone = sq ? z.sq : z.win;
  const door = Z.door ? `<g clip-path="url(#${u}-door)">
      <path d="${z.door}" fill="${panelOf(o.model, o.trim, ang)}"/>
      ${D.body}
      <g transform="${mat(z.dA)}"><rect x="860" y="645" width="300" height="130" fill="url(#${u}-ds)"/><rect class="shine" x="860" y="645" width="300" height="130" fill="url(#${u}-sh)" ${shine}/></g>
    </g>
    <path d="${z.door}" fill="none" stroke="#0E0F10" stroke-width="${Math.max(3.2 * z.ds, 2.8).toFixed(2)}" stroke-linejoin="round"/>
    ${G ? line(876, G.y, 1147, G.y, `stroke="#060606" stroke-opacity=".8" stroke-width="${sw(1.7)}"`) + line(G.x, G.y + 1.5, G.x, 762, `stroke="#060606" stroke-opacity=".8" stroke-width="${sw(1.4)}"`) : ''}` : '';
  const win = Z.win ? `<g clip-path="url(#${u}-win)">
      ${sq ? '' : `<path d="${z.win}" fill="#1C2022"/>`}
      ${W.body}
      ${sq ? (() => { const p = hp(z.Hw, SEAM[0][0], SEAM[0][1]), q2 = hp(z.Hw, SEAM[1][0], SEAM[1][1]); return `<path d="M${p[0].toFixed(1)} ${p[1].toFixed(1)} L${q2[0].toFixed(1)} ${q2[1].toFixed(1)}" stroke="#0A0B0C" stroke-width="${Math.max(2.4 * z.ws, 1.6).toFixed(2)}"/>`; })() : ''}
      <g transform="${mat(z.wA)}"><rect x="${wb[0]}" y="${wb[1]}" width="${wb[2]}" height="${wb[3]}" fill="url(#${u}-ws)"/><rect class="shine" x="${wb[0]}" y="${wb[1]}" width="${wb[2] * 0.9}" height="${wb[3]}" fill="url(#${u}-sh)" ${shine}/></g>
    </g>${sq ? '' : `
    <path d="${z.win}" fill="none" stroke="#0A0B0C" stroke-width="${Math.max(4.5 * z.ws, 3).toFixed(2)}" stroke-linejoin="round"/>`}` : '';
  return `${head}
  <defs>
    <clipPath id="${u}-door"><path d="${z.door}"/></clipPath>
    <clipPath id="${u}-win"><path d="${winZone}"/></clipPath>
    <clipPath id="${u}-badge"><path d="${z.badge || z.door}"/></clipPath>
    <linearGradient id="${u}-ds" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></linearGradient>
    <linearGradient id="${u}-ws" x1="0" y1="0" x2=".5" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
    <linearGradient id="${u}-sh" x1="0" y1="0" x2="1" y2=".4"><stop offset=".25" stop-color="#fff" stop-opacity="0"/><stop offset=".4" stop-color="#fff" stop-opacity=".22"/><stop offset=".47" stop-color="#fff" stop-opacity=".04"/><stop offset=".7" stop-color="#fff" stop-opacity="0"/><stop offset=".78" stop-color="#fff" stop-opacity=".12"/><stop offset=".84" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="${u}-pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#262626"/><stop offset="1" stop-color="#141414"/></linearGradient>
    ${D.defs}${W.defs}${N.defs}
  </defs>
  <g>
    ${N.under}
    ${photo()}
    ${lights}
    ${door}
    ${win}
    ${N.over}
  </g></svg>`;
}

/* ---------- Live stage (hero + configurator) ----------
   Every change is instant: no crossfade, camera tween, drive-in or wipe. When a change needs another photo (angle, car colour,
   Ami version), the old picture stays until the new photo is downloaded and decoded, then the new one replaces it in one step. */
const photoHref = (m: unknown, t: unknown, ang: Angle) => photoURL(trimOf(m, t), ang);
/* Every photo a picture needs (the split car stacks two). */
const photoHrefs = (m: unknown, t: unknown, ang: Angle) => (ang === 'side' && isSplit(m, trimOf(m, t)) ? [photoURL(SPLIT_FRONT, 'side'), photoURL(SPLIT_BACK, 'side')] : [photoHref(m, t, ang)]);
const READY = new Map<string, Promise<unknown>>();
function photoReady(url: string) {
  let p = READY.get(url);
  if (!p) {
    const im = new Image(); im.decoding = 'async'; im.src = url;
    p = im.decode().catch(() => {}).then(() => im); // keeps the decoded image referenced; a failed load just swaps anyway
    READY.set(url, p);
  }
  return p;
}
export class Stage {
  host: HTMLElement; kit: Kit; cfg: Cfg; vname = 'full'; ang: Angle = 'side'; pre = false; night = false;
  u = ''; lc = 0; vb: number[] = []; seq = 0;
  svg: any; slots: any[] = []; plate: any; logo: any; shines: any[] = []; lights: any[] = [];
  constructor(host: HTMLElement, kit: Kit, cfg: Cfg, night = false) { this.host = host; this.kit = kit; this.cfg = { ...cfg }; this.night = night; this.build(); }
  /* (Re)build the SVG for the current config, angle, camera view and day/night. */
  build() {
    const cfg = this.cfg;
    this.seq++; // any rebuild waiting for a photo (swap) is now out of date
    this.ang = angleOf(cfg.model, this.ang);
    const V = viewsAt(cfg.model, this.ang);
    if (!V[this.vname]) this.vname = 'full';
    this.u = 'st' + (++UID); this.lc = 0; this.vb = V[this.vname].slice();
    this.host.innerHTML = carSVG(this.kit, { ...cfg, uid: this.u, view: this.vname, live: true, angle: this.ang, night: this.night });
    this.svg = this.host.firstElementChild;
    this.slots = [q('.slot-door', this.svg), q('.slot-win', this.svg)]; // null where that piece is not in the kit
    this.plate = q('.plate', this.svg); this.logo = q('.plate-logo', this.svg);
    this.shines = qa('.shine', this.svg); this.lights = qa('.lights', this.svg);
  }
  /* Rebuild once the photo for the current config and angle is ready, so there is never a blank frame. */
  swap() {
    const n = ++this.seq, go = () => { if (n === this.seq) this.build(); }, ang = angleOf(this.cfg.model, this.ang);
    Promise.all(photoHrefs(this.cfg.model, this.cfg.trim, ang).map(photoReady)).then(go, go);
  }
  /* The language changed: new accessible name, same picture. */
  setKit(kit: Kit) { this.kit = kit; if (this.svg) this.svg.setAttribute('aria-label', carLabel(kit, this.cfg, true, this.ang)); }
  set(cfg: Cfg) {
    const p = this.cfg; this.cfg = { ...cfg };
    if (!this.kit.D(cfg.design)) return;
    // Another Ami version or car colour needs another photo.
    if ((p.model || 'qs') !== (cfg.model || 'qs') || trimOf(p.model, p.trim) !== trimOf(cfg.model, cfg.trim)) { this.swap(); this.preload(); return; }
    if (zonesKey(p) !== zonesKey(cfg)) { this.build(); return; } // other kit pieces: same photo, new set of stickers
    this.svg.setAttribute('aria-label', carLabel(this.kit, cfg, true, this.ang));
    if (p.design !== cfg.design) { this.build(); return; } // another design may have other cut gaps (creases): rebuild
    if (p.c1 !== cfg.c1 || p.c2 !== cfg.c2) this.paint();
    const t = plateText(cfg);
    if (t !== plateText(p) || p.c1 !== cfg.c1) {
      this.lights.forEach((l) => l.setAttribute('fill', hex(cfg.c1)));
      if (!this.plate) return; // front view: no badge
      this.plate.textContent = cfg.numberOn ? cfg.number : '';
      this.plate.setAttribute('fill', hex(cfg.c1));
      this.logo.setAttribute('fill', hex(cfg.c1));
      this.logo.style.opacity = t ? 0 : 1;
    }
  }
  /* Turn the car to another camera angle, same design and colours, camera back to that angle's full view. */
  angle(name: Angle) {
    const a = angleOf(this.cfg.model, name);
    if (a === this.ang) return;
    this.ang = a; this.vname = 'full'; this.swap();
  }
  currentAngle() { return this.ang; }
  /* Night scene: headlights and rear lights on, the car a little darker (same photo, so the picture is rebuilt at once). */
  setNight(on: boolean) {
    on = !!on;
    if (on === this.night) return;
    this.night = on;
    this.build();
  }
  /* Fetch and decode the other angles' photos of this car colour in the background, so turning the car is instant
     (configurator only). */
  preload(on?: boolean) {
    if (on) this.pre = true;
    if (!this.pre) return;
    anglesOf(this.cfg.model).forEach((a) => photoHrefs(this.cfg.model, this.cfg.trim, a).forEach(photoReady));
  }
  /* New colours: swap the sticker artwork in place (only the zones in the kit: none in the front view). */
  paint() {
    const C = this.cfg, lid = this.u + 'L' + (++this.lc), A = ART[C.design] || NO_ART, shape = winShapeOf(C);
    const fns = [A.door, (a: string, b: string, u: string) => winArt(C.model, A, a, b, u, shape)];
    [0, 1].forEach((n) => {
      const slot = this.slots[n]; if (!slot) return;
      const g = document.createElementNS(NS, 'g'); g.innerHTML = fns[n](hex(C.c1), hex(C.c2), lid + n);
      slot.replaceChildren(g);
    });
  }
  /* Camera presets. The door and window close-ups exist only in the side view, so the car turns to the side first. */
  view(name: string) {
    const turn = (name === 'door' || name === 'window') && this.ang !== 'side' && anglesOf(this.cfg.model).length > 1;
    if (turn) this.ang = 'side';
    const V = viewsAt(this.cfg.model, this.ang);
    this.vname = V[name] ? name : 'full';
    if (turn) this.swap(); // the rebuilt picture opens on this.vname
    else this.jump(V[this.vname]);
  }
  /* Zoom in (f < 1) or out (f > 1) around the middle of what is on screen, never wider than the full car or closer than 30%. */
  zoom(f: number) {
    const full = viewsAt(this.cfg.model, this.ang).full, [x, y, w, h] = this.vb;
    const nw = Math.min(full[2], Math.max(full[2] * 0.3, w * f)), nh = nw * (full[3] / full[2]);
    this.jump(this.clampBox([x + w / 2 - nw / 2, y + h / 2 - nh / 2, nw, nh]));
  }
  /* Drag the zoomed picture by (dx, dy) screen pixels. */
  pan(dx: number, dy: number) {
    const r = this.svg.getBoundingClientRect(); if (!r.width) return;
    const k = this.vb[2] / r.width;
    this.jump(this.clampBox([this.vb[0] - dx * k, this.vb[1] - dy * k, this.vb[2], this.vb[3]]));
  }
  /* True when closer than the full-car view (the picture can then be dragged). */
  zoomed() { return this.vb[2] < viewsAt(this.cfg.model, this.ang).full[2] - 1; }
  /* Keep a camera box inside the full-car frame. */
  clampBox(b: number[]) {
    const f = viewsAt(this.cfg.model, this.ang).full;
    return [Math.min(Math.max(b[0], f[0]), f[0] + f[2] - b[2]), Math.min(Math.max(b[1], f[1]), f[1] + f[3] - b[3]), b[2], b[3]];
  }
  /* Move the camera straight to a box (no tween). */
  jump(box: number[]) {
    this.vb = box.slice();
    this.svg.setAttribute('viewBox', this.vb.map((n) => n.toFixed(2)).join(' '));
  }
  /* Drive-in support: a copy of each wheel's rim (the photo clipped to the rim circle), turned by deg around the wheel centre, over the
     photo. deg = null removes it (a 360 x n turn looks exactly like the photo, so the overlay is dropped at the end). Side view only. */
  wheelSpin(deg: number | null) {
    let g = q('.wheels', this.svg);
    if (deg === null || this.ang !== 'side' || !this.svg) { if (g) g.remove(); return; }
    const M = MOD(this.cfg.model), u = this.u;
    if (!g) {
      const trim = trimOf(this.cfg.model, this.cfg.trim), split = isSplit(this.cfg.model, trim);
      const nf = this.night ? ` filter="url(#${u}-nd)"` : '';
      g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'wheels'); g.setAttribute('aria-hidden', 'true');
      g.innerHTML = (M.wheels as number[][]).map(([cx, cy], i) => {
        const img = split ? `href="${photoURL(i ? SPLIT_BACK : SPLIT_FRONT, 'side')}" width="2000" height="1125"` : imgOf(this.cfg.model, this.cfg.trim, 'side');
        return `<clipPath id="${u}-wh${i}"><circle cx="${cx}" cy="${cy}" r="${M.rimR}"/></clipPath><g clip-path="url(#${u}-wh${i})"><g class="wr" data-c="${cx} ${cy}"><image ${img}${nf}/></g></g>`;
      }).join('');
      this.svg.lastElementChild.append(g);
    }
    qa('.wr', g).forEach((w) => w.setAttribute('transform', `rotate(${deg.toFixed(2)} ${w.getAttribute('data-c')})`));
  }
  /* Rolling geometry for the drive-in: rolling radius of the tyre and the svg units per screen pixel. */
  rollInfo() { const r = this.svg.getBoundingClientRect(); return { tyreR: MOD(this.cfg.model).tyreR as number, unitsPerPx: r.width ? this.vb[2] / r.width : 1 }; }
  destroy() { this.seq++; } // cancels a rebuild still waiting for its photo
}

/* Server render and first paint of the live car: the same picture the Stage draws first (side view, full car, by day), so the
   photo shows before any script runs and nothing moves when the Stage takes over. */
export const stagePoster = (kit: Kit, cfg: Cfg, uid: string) => carSVG(kit, { ...cfg, uid, view: 'full', live: true, angle: 'side' });
/* First car photo of the hero and the configurator (preloaded from the page <head>). */
export const POSTER_PHOTO = photoURL(TRIMS.qs[0], 'side');

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
