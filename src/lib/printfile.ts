/* Print files from the design masters (admin page only, lazy-loaded).

   A MASTER is one SVG per design, drawn in millimetres at real size (the door sticker sheet is 746 x 285 mm, plus 5 mm bleed
   all round). It has two layers:
     <g id="Artwork">   the art. Parts that change with the customer's colours carry data-slot="c1" or data-slot="c2".
     <g id="CutContour"> the cut lines (magenta in the SVG; a spot colour called CutContour in the PDF).
   To make a customer's print file the two slot colours are swapped and the result is written out as:
     - an SVG (all vector), and
     - a PDF at true scale, all vector (no pictures), cut line as the CutContour spot colour, with a trim box.
   The PDF writer below is small and has no libraries: it supports the shapes the masters use (path with M L H V C Z, circle, rect,
   groups that pass fill / stroke settings down). Built-in masters live in src/data/masters/<name>.svg; designs added in the admin
   keep their master on the shop's server (setRemoteMaster). */
import type { Cfg, Kit } from './kit';

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
export const svgBlob = (master: string, c1: string | null, c2: string | null) => new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + moldSVG(master, c1, c2, { download: true })], { type: 'image/svg+xml' });

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

async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (typeof CompressionStream === 'undefined') return null;
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
}

/* A true-scale vector PDF of the master in the customer's colours. */
export async function pdfBlob(master: string, c1: string | null, c2: string | null, title = 'OFS/T print file'): Promise<Blob> {
  const doc = parseXml(colourMaster(master, c1, c2));
  const { content, w, h, trim } = buildPdfContent(doc);
  const enc = new TextEncoder(), raw = enc.encode(content), packed = await deflate(raw), body = packed || raw;
  const parts: Uint8Array[] = [], offsets: number[] = [];
  let len = 0;
  const push = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); len += u.length; };
  const obj = (n: number, text: string) => { offsets[n] = len; push(`${n} 0 obj\n${text}\nendobj\n`); };
  push('%PDF-1.6\n%\xE2\xE3\xCF\xD3\n'.replace(/[\u0080-ÿ]/g, ' '));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  const box = (b: number[]) => `[${b.map(f).join(' ')}]`;
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(w)} ${f(h)}] /BleedBox [0 0 ${f(w)} ${f(h)}] /TrimBox ${box(trim)} /Contents 4 0 R /Resources << /ColorSpace << /CutCS [/Separation /CutContour /DeviceCMYK 5 0 R] >> /ExtGState << /GS0 << /OP true /op true /OPM 1 >> >> >> >>`);
  offsets[4] = len; push(`4 0 obj\n<< /Length ${body.length}${packed ? ' /Filter /FlateDecode' : ''} >>\nstream\n`); push(body); push('\nendstream\nendobj\n');
  obj(5, '<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 1 0 0] /N 1 >>');
  obj(6, `<< /Title (${title.replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '')}) /Producer (OFS/T) >>`);
  const xref = len;
  push(`xref\n0 7\n0000000000 65535 f \n${[1, 2, 3, 4, 5, 6].map((n) => String(offsets[n]).padStart(10, '0') + ' 00000 n \n').join('')}`);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

/* ---------- File names ---------- */
const safeTag = (t: unknown) => String(t || '').replace(/[^A-Z0-9-]/gi, '').slice(0, 12);
export const fileBase = (kit: Kit, c: Cfg, tag: string) => `OFS-T_${safeTag(tag) ? safeTag(tag) + '_' : ''}${c.design}_${kit.D(c.design)!.fixed ? 'original' : c.c1 + '-' + c.c2}_door`;
export function saveFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.hidden = true; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- Preview pictures for the shop (used by the admin "Designs" tab for a design added there) ----------
   Same recipe as scripts/make-art.mjs: a tone mask for recolourable designs, a full-colour picture for fixed ones. */
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
