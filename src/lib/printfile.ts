/* Print files (admin page only, lazy-loaded).

   THE PRINT FILE IS A JPEG of the owner's final artwork with only the two colours changed (the supplier already owns the cutting mould).
   The built-in design's artwork is src/data/masters/flame-final-door.jpg (door sheet) and flame-final-window.png (Ami Pop window); the
   script scripts/make-print-maps.py turns each into a WEIGHT MAP (public/assets/print/*.png: per pixel the share of colour 1, colour 2
   and white, black = the rest). Here the map is recoloured (black #000000, white #FFFFFF, c1, c2 = the order's colours) and written as a
   4:4:4 quality-100 JPEG by ./jpeg444 (same pixels as the artwork, nothing resampled).
   Designs added in the admin only have a vector MASTER (one SVG, millimetres, layers <g id="Artwork"> with data-slot="c1" / "c2"
   parts and <g id="CutContour">): for those the master is drawn to a picture (without the cut line) and written as the same kind of JPEG.
   The master code below (parse, recolour, sanitize, validate) is also used by the admin preview and the "Designs" tab.
   Built-in masters live in src/data/masters/<name>.svg; masters of added designs stay on the shop's server (setRemoteMaster). */
import { includedPieces, normWinShape, type Cfg, type Kit } from './kit';
import { encodeJpeg444 } from './jpeg444';

const BUILTIN = import.meta.glob('../data/masters/*.svg', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
const cache = new Map<string, string>();
let remoteMaster: ((id: string) => Promise<string>) | null = null;
export const setRemoteMaster = (fn: ((id: string) => Promise<string>) | null) => { remoteMaster = fn; };
export const dropMasterCache = (id?: string) => { if (id) cache.delete(id); else cache.clear(); };

export const SHEET_MM = { w: 746, h: 285 }; // the door sticker sheet (every master uses the same mold)

/* The master SVG text of a design. */
export async function loadMaster(kit: Kit, id: string): Promise<string> {
  const hit = cache.get(id); if (hit) return hit;
  const d = kit.D(id) as any;
  const file = d && d.master ? BUILTIN[`../data/masters/${d.master}.svg`] : null;
  let svg: string;
  if (file) svg = await file();
  else if (remoteMaster) svg = await remoteMaster(id);
  else throw new Error('no_master');
  cache.set(id, svg);
  return svg;
}

/* ---------- Reading a master ---------- */
const NS = 'http://www.w3.org/2000/svg';
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('Not a valid SVG file.');
  return doc;
}
function viewBoxOf(root: Element): [number, number, number, number] {
  const v = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (v.length !== 4 || v.some((n) => !Number.isFinite(n)) || v[2] <= 0 || v[3] <= 0) throw new Error('The SVG needs a viewBox in millimetres (e.g. "-5 -5 756 295").');
  return v as [number, number, number, number];
}

/* Two slot colours swapped in (null = keep the master's own colours, used for fixed-colour designs); everything else is left exactly as drawn. Returns the SVG text. */
export function colourMaster(svg: string, c1: string | null, c2: string | null): string {
  const doc = parseXml(svg);
  doc.querySelectorAll('[data-slot]').forEach((el) => {
    const hex = el.getAttribute('data-slot') === 'c1' ? c1 : el.getAttribute('data-slot') === 'c2' ? c2 : null;
    if (hex && HEX.test(hex)) el.setAttribute('fill', hex);
  });
  return new XMLSerializer().serializeToString(doc);
}

/* What a master contains, for the "add a design" form. Throws a plain-language Error when it can't be used. */
export function inspectMaster(svg: string) {
  if (svg.length > 3_000_000) throw new Error('This file is too big (over 3 MB). Simplify the artwork and try again.');
  const doc = parseXml(svg), root = doc.documentElement;
  const vb = viewBoxOf(root);
  const bleed = vb[0] < 0 ? -vb[0] : 0;
  const w = vb[2] - 2 * bleed, h = vb[3] - 2 * bleed;
  if (Math.abs(w - SHEET_MM.w) > 1.5 || Math.abs(h - SHEET_MM.h) > 1.5) throw new Error(`The sheet must be ${SHEET_MM.w} x ${SHEET_MM.h} mm (the door mold) plus bleed; this one is ${w.toFixed(0)} x ${h.toFixed(0)} mm.`);
  if (!root.querySelector('#Artwork')) throw new Error('Missing the layer <g id="Artwork">.');
  if (!root.querySelector('#CutContour')) throw new Error('Missing the layer <g id="CutContour"> (the cut lines).');
  const slots = { c1: !!root.querySelector('[data-slot="c1"]'), c2: !!root.querySelector('[data-slot="c2"]') };
  if (root.querySelector('image, linearGradient, radialGradient, filter, text, use')) throw new Error('The master must be pure vector shapes: no pictures, gradients, filters, text or <use>. Convert text to outlines.');
  buildPdfContent(doc); // dry run: throws when a shape or path command is not supported
  return { sheetW: w, sheetH: h, bleed, slots, recolourable: slots.c1 || slots.c2 };
}

/* ---------- SVG for the screen and for download ---------- */
/* Master with the customer's colours, sized by CSS (for the admin preview) or in mm (for the download). */
/* Safety net: a master comes from the shop's server, and the preview puts it into the page as markup, so anything that is not
   plain drawing (scripts, images, links, event handlers, styles) is removed here. */
const OK_TAGS = new Set(['svg', 'g', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'title', 'desc']);
const OK_ATTRS = new Set(['id', 'viewBox', 'xmlns', 'width', 'height', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'data-slot', 'preserveAspectRatio', 'version']);
function sanitize(el: Element) {
  for (const a of Array.from(el.attributes)) if (!OK_ATTRS.has(a.name) || /javascript:|url\(|<|&#/i.test(a.value)) el.removeAttribute(a.name);
  for (const ch of Array.from(el.children)) { if (!OK_TAGS.has(ch.localName)) ch.remove(); else sanitize(ch); }
}
export function moldSVG(master: string, c1: string | null, c2: string | null, { label = '', download = false }: { label?: string; download?: boolean } = {}) {
  const doc = parseXml(colourMaster(master, c1, c2)), root = doc.documentElement;
  sanitize(root);
  if (!download) { root.removeAttribute('width'); root.removeAttribute('height'); }
  if (label) { root.setAttribute('role', 'img'); root.setAttribute('aria-label', label); }
  return new XMLSerializer().serializeToString(doc);
}

/* ---------- PDF ---------- */
const MM = 72 / 25.4;
interface Style { fill: number[] | null; stroke: number[] | null; sw: number; cap: number; join: number; evenodd: boolean; cut: boolean }
const num = (v: string | null, d: number) => { const n = parseFloat(v || ''); return Number.isFinite(n) ? n : d; };
function colour(v: string | null, fallback: number[] | null): number[] | null {
  if (v == null || v === '') return fallback;
  const s = v.trim().toLowerCase();
  if (s === 'none' || s === 'transparent') return null;
  if (s === 'black') return [0, 0, 0];
  if (s === 'white') return [1, 1, 1];
  if (HEX.test(s)) { const h = s.length === 4 ? '#' + [...s.slice(1)].map((c) => c + c).join('') : s; return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); }
  throw new Error(`Colour "${v}" is not supported: use #RRGGBB.`);
}
const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

function buildPdfContent(doc: Document) {
  const root = doc.documentElement, [vx, vy, vw, vh] = viewBoxOf(root);
  const X = (x: number) => f((x - vx) * MM), Y = (y: number) => f((vy + vh - y) * MM);
  const out: string[] = [];
  const pt = (x: number, y: number) => `${X(x)} ${Y(y)}`;

  function pathOps(d: string): string {
    const toks = d.match(/[MmLlHhVvCcZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?|[^\s,]/gi) || [];
    let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0, ops = '';
    const n = () => { const t = toks[i++]; const v = parseFloat(t); if (!Number.isFinite(v)) throw new Error(`Unsupported path data near "${t}": only M, L, H, V, C and Z are supported.`); return v; };
    while (i < toks.length) {
      if (/^[A-Za-z]$/.test(toks[i])) { cmd = toks[i++]; if (!/[MmLlHhVvCcZz]/.test(cmd)) throw new Error(`Unsupported path command "${cmd}": only M, L, H, V, C and Z are supported.`); } else if (!cmd) throw new Error('Bad path data.');
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
      if (C === 'Z') { ops += 'h\n'; cx = sx; cy = sy; continue; }
      if (C === 'M') { let x = n(), y = n(); if (rel) { x += cx; y += cy; } cx = sx = x; cy = sy = y; ops += `${pt(x, y)} m\n`; cmd = rel ? 'l' : 'L'; }
      else if (C === 'L') { let x = n(), y = n(); if (rel) { x += cx; y += cy; } cx = x; cy = y; ops += `${pt(x, y)} l\n`; }
      else if (C === 'H') { let x = n(); if (rel) x += cx; cx = x; ops += `${pt(cx, cy)} l\n`; }
      else if (C === 'V') { let y = n(); if (rel) y += cy; cy = y; ops += `${pt(cx, cy)} l\n`; }
      else if (C === 'C') {
        let a = n(), b = n(), c = n(), d2 = n(), e = n(), g = n();
        if (rel) { a += cx; b += cy; c += cx; d2 += cy; e += cx; g += cy; }
        ops += `${pt(a, b)} ${pt(c, d2)} ${pt(e, g)} c\n`; cx = e; cy = g;
      }
    }
    return ops;
  }
  const circleOps = (cx: number, cy: number, r: number) => {
    const k = 0.5522847498 * r;
    return `${pt(cx + r, cy)} m\n${pt(cx + r, cy + k)} ${pt(cx + k, cy + r)} ${pt(cx, cy + r)} c\n${pt(cx - k, cy + r)} ${pt(cx - r, cy + k)} ${pt(cx - r, cy)} c\n`
      + `${pt(cx - r, cy - k)} ${pt(cx - k, cy - r)} ${pt(cx, cy - r)} c\n${pt(cx + k, cy - r)} ${pt(cx + r, cy - k)} ${pt(cx + r, cy)} c\nh\n`;
  };
  const rgb = (c: number[]) => c.map(f).join(' ');
  function paint(ops: string, s: Style) {
    if (!s.fill && !s.stroke) return;
    let head = '';
    if (s.fill) head += `${rgb(s.fill)} rg\n`;
    if (s.stroke) head += s.cut ? '/CutCS CS 1 SCN\n/GS0 gs\n' : `${rgb(s.stroke)} RG\n`;
    if (s.stroke) head += `${f(s.sw * MM)} w ${s.cap} J ${s.join} j\n`;
    const op = s.fill && s.stroke ? (s.evenodd ? 'B*' : 'B') : s.fill ? (s.evenodd ? 'f*' : 'f') : 'S';
    out.push(head + ops + op + '\n');
  }
  function walk(el: Element, inh: Style) {
    for (const k of Array.from(el.children)) {
      const tag = k.localName;
      if (tag === 'title' || tag === 'desc' || tag === 'metadata') continue;
      const cut = inh.cut || k.getAttribute('id') === 'CutContour';
      const s: Style = {
        fill: colour(k.getAttribute('fill'), inh.fill), stroke: colour(k.getAttribute('stroke'), inh.stroke), sw: num(k.getAttribute('stroke-width'), inh.sw),
        cap: ({ butt: 0, round: 1, square: 2 } as Record<string, number>)[k.getAttribute('stroke-linecap') || ''] ?? inh.cap,
        join: ({ miter: 0, round: 1, bevel: 2 } as Record<string, number>)[k.getAttribute('stroke-linejoin') || ''] ?? inh.join,
        evenodd: k.getAttribute('fill-rule') ? k.getAttribute('fill-rule') === 'evenodd' : inh.evenodd, cut,
      };
      if (k.getAttribute('transform')) throw new Error('Transforms are not supported: apply them to the shapes before saving.');
      if (tag === 'g') walk(k, s);
      else if (tag === 'path') paint(pathOps(k.getAttribute('d') || ''), s);
      else if (tag === 'circle') paint(circleOps(num(k.getAttribute('cx'), 0), num(k.getAttribute('cy'), 0), num(k.getAttribute('r'), 0)), s);
      else if (tag === 'rect') {
        const x = num(k.getAttribute('x'), 0), y = num(k.getAttribute('y'), 0), w = num(k.getAttribute('width'), 0), h = num(k.getAttribute('height'), 0);
        paint(`${pt(x, y)} m\n${pt(x + w, y)} l\n${pt(x + w, y + h)} l\n${pt(x, y + h)} l\nh\n`, s);
      } else if (tag !== 'defs') throw new Error(`The element <${tag}> is not supported in a master.`);
    }
  }
  walk(root, { fill: [0, 0, 0], stroke: null, sw: 1, cap: 0, join: 0, evenodd: false, cut: false });
  const bleed = vx < 0 ? -vx : 0;
  return { content: out.join(''), w: vw * MM, h: vh * MM, trim: [bleed * MM, bleed * MM, (vw - bleed) * MM, (vh - bleed) * MM] };
}

/* ---------- JPEG print files ---------- */
const MAP_DIR = import.meta.env.BASE_URL + 'assets/print/';
/* Per built-in artwork (design.art): its weight maps and the grey levels the artwork was drawn with (used for fixed-colour designs, which print as drawn). */
const ART_MAPS: Record<string, { door: string; win: string; doorGreys: [number, number]; winGreys: [number, number] }> = {
  flame: { door: 'flame-door-map.png', win: 'flame-win-map.png', doorGreys: [51, 92], winGreys: [51, 71] },
};
/* The door sticker's bounding box inside the 2000 x 852 picture (same box scripts/make-art.py crops, ART_SIZE in car.ts), and the rear window
   of the Ami 2025 = its right-hand part (WIN_CROP in car.ts: x from 1000/1946 of the sheet width, width 683/1946, full height). */
const DOOR_BOX = { x: 28, y: 75, w: 1946, h: 708 };
const WIN_CROP_X = 1000, WIN_CROP_W = 683;
/* Print size: the sticker box (1946 px) is the 746 mm wide door mould, i.e. 66 px per inch (JFIF stores whole dpi: 749 mm). The Ami Pop window
   picture has no known physical size: 72 dpi (nominal). */
export const DOOR_DPI = 66, POP_WIN_DPI = 72;

interface Plane { w: number; h: number; data: Uint8ClampedArray }
const planes = new Map<string, Promise<Plane>>();
function loadPlane(file: string): Promise<Plane> {
  let p = planes.get(file);
  if (!p) {
    p = (async () => {
      const img = new Image(); img.src = MAP_DIR + file; await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(img, 0, 0);
      return { w: cv.width, h: cv.height, data: ctx.getImageData(0, 0, cv.width, cv.height).data };
    })();
    planes.set(file, p);
    p.catch(() => planes.delete(file));
  }
  return p;
}
export const hexRgb = (hex: string | null | undefined, fallback: [number, number, number]): [number, number, number] => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : fallback;
};
/* map pixel (R = share of colour 1, G = colour 2, B = white, black = the rest) -> colours. Returns RGBA of the rectangle. */
export function recolourMap(map: Plane, c1: number[], c2: number[], rect: { x: number; y: number; w: number; h: number }): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4), d = map.data;
  let o = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    let i = (y * map.w + rect.x) * 4;
    for (let x = 0; x < rect.w; x++, i += 4, o += 4) {
      const a = d[i], b = d[i + 1], w = d[i + 2];
      for (let k = 0; k < 3; k++) out[o + k] = Math.round((a * c1[k] + b * c2[k] + w * 255) / 255);
      out[o + 3] = 255;
    }
  }
  return out;
}
const jpegBlob = (rgba: Uint8ClampedArray, w: number, h: number, dpi: number) => new Blob([encodeJpeg444(rgba, w, h, { quality: 100, dpi }) as BlobPart], { type: 'image/jpeg' });

/* A built-in master of an added design drawn as a picture (no cut line), 2400 px wide. */
async function masterJpeg(master: string, c1: string | null, c2: string | null): Promise<Blob> {
  const doc = parseXml(colourMaster(master, c1, c2)), root = doc.documentElement;
  root.querySelector('#CutContour')?.remove();
  sanitize(root);
  const [, , vw, vh] = viewBoxOf(root), W = 2400, H = Math.round((W * vh) / vw);
  root.setAttribute('width', String(W)); root.setAttribute('height', String(H));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
  try {
    const img = new Image(); img.src = url; await img.decode();
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H);
    return jpegBlob(ctx.getImageData(0, 0, W, H).data, W, H, Math.round((W * 25.4) / vw));
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- File names ---------- */
const safeTag = (t: unknown) => String(t || '').replace(/[^A-Z0-9-]/gi, '').slice(0, 12);
const slug = (t: unknown) => String(t || '').replace(/[^a-z0-9]+/gi, '').toLowerCase().slice(0, 24) || 'x';
/* OFST-<order#>-<model>-<part>-<colour1>-<colour2>  (part: door | window-full | window-square | window-circle) */
export const fileBase = (c: Cfg, tag: string, part: string, fixed = false) =>
  `OFST-${safeTag(tag) ? safeTag(tag) + '-' : ''}${c.model === 'pop' ? 'amipop' : 'ami2025'}-${part}-${fixed ? 'original' : slug(c.c1) + '-' + slug(c.c2)}`;
export function saveFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.hidden = true; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export interface PrintFile { name: string; blob: Blob }
/* The print files of one ordered kit, as JPEGs of the final artwork in the order's two colours:
     door sheet      (kits with door stickers)     the whole 2000 x 852 picture of the sheet
     window          Ami 2025 'full' / 'square'    the window part of the recoloured sheet (the supplier cuts the shape with their own mould)
                     Ami Pop 'circle'              the half-ring window picture
   There is no artwork for the Pop front accent piece: no file is made for it. Older orders (only design / c1 / c2) are the full kit, and a
   missing window shape or unknown colour gets the model's default / the design's own colours. Returns [] when the kit has no printable piece. */
export async function printFiles(kit: Kit, c: Cfg, tag: string): Promise<PrintFile[]> {
  const d = kit.D(c.design), model = c.model === 'pop' ? 'pop' : 'qs';
  const fixed = !!d?.fixed;
  const hex = (id: string, fb: string | undefined) => kit.COLORS[id]?.hex || fb || null;
  const h1 = fixed ? null : hex(c.c1, d?.c1 && kit.COLORS[d.c1]?.hex), h2 = fixed ? null : hex(c.c2, d?.c2 && kit.COLORS[d.c2]?.hex);
  const pieces = includedPieces({ model, pieces: kit.piecesOf({ ...c, model }) });
  const wantDoor = pieces.includes('door'), wantWin = pieces.includes('window');
  const out: PrintFile[] = [];
  const maps = d ? ART_MAPS[d.art || ''] : ART_MAPS.flame;
  if (!maps) { // a design added in the admin: only its vector master exists
    if (wantDoor || wantWin) out.push({ name: fileBase(c, tag, 'door', fixed) + '.jpg', blob: await masterJpeg(await loadMaster(kit, c.design), h1, h2) });
    return out;
  }
  const dc1 = fixed ? maps.doorGreys[0] : 0, dc2 = fixed ? maps.doorGreys[1] : 0;
  const door1 = fixed ? [dc1, dc1, dc1] : hexRgb(h1, [51, 51, 51]), door2 = fixed ? [dc2, dc2, dc2] : hexRgb(h2, [92, 92, 92]);
  if (wantDoor || (wantWin && model === 'qs')) {
    const sheet = await loadPlane(maps.door);
    if (wantDoor) out.push({ name: fileBase(c, tag, 'door', fixed) + '.jpg', blob: jpegBlob(recolourMap(sheet, door1, door2, { x: 0, y: 0, w: sheet.w, h: sheet.h }), sheet.w, sheet.h, DOOR_DPI) });
    if (wantWin && model === 'qs') {
      const shape = normWinShape(c.winShape, 'qs'), r = { x: DOOR_BOX.x + WIN_CROP_X, y: DOOR_BOX.y, w: WIN_CROP_W, h: DOOR_BOX.h };
      out.push({ name: fileBase(c, tag, 'window-' + shape, fixed) + '.jpg', blob: jpegBlob(recolourMap(sheet, door1, door2, r), r.w, r.h, DOOR_DPI) });
    }
  }
  if (wantWin && model === 'pop') {
    const win = await loadPlane(maps.win), w1 = fixed ? [maps.winGreys[0], maps.winGreys[0], maps.winGreys[0]] : hexRgb(h1, [51, 51, 51]), w2 = fixed ? [maps.winGreys[1], maps.winGreys[1], maps.winGreys[1]] : hexRgb(h2, [71, 71, 71]);
    out.push({ name: fileBase(c, tag, 'window-circle', fixed) + '.jpg', blob: jpegBlob(recolourMap(win, w1, w2, { x: 0, y: 0, w: win.w, h: win.h }), win.w, win.h, POP_WIN_DPI) });
  }
  return out;
}

/* ---------- Preview pictures for the shop (used by the admin "Designs" tab for a design added there) ----------
   Same recipe as the old master-based art script (the built-in design is now made by scripts/make-art.py from a picture): a tone mask for recolourable designs, a full-colour picture for fixed ones. */
export type ArtMode = 'mask' | 'rgb';
export async function artPictures(master: string, mode: ArtMode): Promise<{ w1000: Blob; w1600: Blob }> {
  const info = inspectMaster(master), doc = parseXml(master), root = doc.documentElement;
  const [vx, vy] = viewBoxOf(root);
  const sheet = { w: info.sheetW, h: info.sheetH };
  // Base colour only inside the cut outlines (even-odd): the ring-shaped gap around the door's middle piece stays transparent.
  const outline = Array.from(root.querySelectorAll('#CutContour path')).map((e) => e.getAttribute('d') || '').join(' ').trim();
  root.querySelector('#CutContour')?.remove();
  let baseFill = '#000000';
  if (mode === 'mask') {
    root.querySelectorAll('[data-slot="c1"]').forEach((e) => e.setAttribute('fill', '#FF0000'));
    root.querySelectorAll('[data-slot="c2"]').forEach((e) => e.setAttribute('fill', '#00FF00'));
    root.querySelectorAll('[fill]').forEach((e) => { if (/^#fff(fff)?$/i.test(e.getAttribute('fill') || '')) e.setAttribute('fill', '#0000FF'); });
    root.querySelectorAll('[stroke]').forEach((e) => { if (/^#fff(fff)?$/i.test(e.getAttribute('stroke') || '')) e.setAttribute('stroke', '#0000FF'); });
    baseFill = '#FF0000';
  } else {
    const c1 = root.querySelector('[data-slot="c1"]'); baseFill = c1?.getAttribute('fill') || '#333333';
  }
  const bg = doc.createElementNS(NS, outline ? 'path' : 'rect');
  if (outline) { bg.setAttribute('d', outline); bg.setAttribute('fill-rule', 'evenodd'); } else {
    bg.setAttribute('x', String(vx)); bg.setAttribute('y', String(vy)); bg.setAttribute('width', String(sheet.w + 2 * info.bleed)); bg.setAttribute('height', String(sheet.h + 2 * info.bleed));
  }
  bg.setAttribute('fill', baseFill);
  const art = root.querySelector('#Artwork')!; art.insertBefore(bg, art.firstChild);
  if (outline) { // also clip the art at the cut outlines: the printed bleed (past the cut) would otherwise narrow the gap in the preview
    const cp = doc.createElementNS(NS, 'clipPath'), cpp = doc.createElementNS(NS, 'path');
    cp.setAttribute('id', 'cutclip'); cpp.setAttribute('d', outline); cpp.setAttribute('clip-rule', 'evenodd'); cp.append(cpp);
    root.insertBefore(cp, art); art.setAttribute('clip-path', 'url(#cutclip)');
  }
  root.setAttribute('viewBox', `0 0 ${sheet.w} ${sheet.h}`);
  root.setAttribute('shape-rendering', 'geometricPrecision');
  const make = async (W: number) => {
    const H = Math.round(W * sheet.h / sheet.w);
    root.setAttribute('width', String(W)); root.setAttribute('height', String(H));
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
    try {
      const img = new Image(); img.src = url; await img.decode();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d')!; ctx.drawImage(img, 0, 0, W, H);
      const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'));
      if (!blob) throw new Error('encode');
      return blob;
    } finally { URL.revokeObjectURL(url); }
  };
  return { w1000: await make(1000), w1600: await make(1600) };
}

/* The two slot colours for a kit: the customer's choice, or null for fixed-colour designs (they print exactly as drawn). */
export const slotColours = (kit: Kit, c: Cfg): [string | null, string | null] => (kit.D(c.design)?.fixed ? [null, null] : [kit.COLORS[c.c1]?.hex || null, kit.COLORS[c.c2]?.hex || null]);
