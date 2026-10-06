/* Print mold (door sticker) for the admin page.
   Mold traced from the supplied door sticker: outer shape, badge ring cut-out and the two seam cuts (units 1000 x 364.68).
   Designs are fitted by mapping the car's door panel (876,658 271x104 in car.ts coordinates) onto the mold. */
import DATA from '../data/designs.json';
import { ART } from './car';
import { MOLD, FLAME, STEALTH } from './moldData';
import type { Cfg, Kit } from './kit';

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c as string] as string));
const COLORS = DATA.colors as Record<string, { hex: string }>;
const hex = (k: string) => (COLORS[k] || COLORS[Object.keys(COLORS)[0]]).hex;
let UID = 0;

function moldArt(kit: Kit, c: Cfg, u: string) {
  const d = kit.D(c.design)!, a = hex(c.c1), b = hex(c.c2);
  if (d.art === 'flame') return `<rect x="-10" y="-10" width="1020" height="385" fill="#000"/><path d="${FLAME.dark}" fill="${b}"/><path d="${FLAME.light}" fill="${a}"/><path d="${FLAME.white}" fill="#fff"/>`;
  if (d.art === 'stealth') return `<image href="${STEALTH}" x="-6" y="-6" width="1012" height="377" preserveAspectRatio="none"/>`;
  const A = ART[c.design];
  return `<rect x="-10" y="-10" width="1020" height="385" fill="#18191A"/>` + (A ? `<g transform="scale(${(1000 / 271).toFixed(5)} ${(364.68 / 104).toFixed(5)}) translate(-876 -658)">${A.door(a, b, u + 'a')}</g>` : '');
}

export function moldSVG(kit: Kit, c: Cfg, { u = 'm' + (++UID), cut = false, width = 0, guide = false, label = '' }: { u?: string; cut?: boolean; width?: number; guide?: boolean; label?: string } = {}) {
  const M = MOLD as any;
  const cutLayer = cut ? `<g id="CutContour" fill="none" stroke="#FF00FF" stroke-width=".35"><path d="${M.outer}"/><path d="${M.ringO}"/><path d="${M.ringI}"/>
    <g clip-path="url(#${u}-oc)">${M.cuts.map(([x, y, w, h]: number[]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join('')}</g></g>` : '';
  const a11y = label ? ` role="img" aria-label="${esc(label)}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${M.w} ${M.h}"${width ? ` width="${width}" height="${(width * M.h / M.w).toFixed(0)}"` : ''}${a11y}>
  <defs><mask id="${u}-mk" maskUnits="userSpaceOnUse" x="-10" y="-10" width="1020" height="385"><path d="${M.outer}" fill="#fff"/><path d="${M.ringO} ${M.ringI}" fill="#000" fill-rule="evenodd"/>${M.cuts.map(([x, y, w, h]: number[]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000"/>`).join('')}</mask>
  <clipPath id="${u}-oc"><path d="${M.outer}"/></clipPath></defs>
  <g mask="url(#${u}-mk)"><g id="Artwork">${moldArt(kit, c, u)}</g></g>${guide ? `<path d="${M.outer}" fill="none" stroke="#888" stroke-opacity=".5" stroke-width="1"/>` : ''}${cutLayer}</svg>`;
}

const safeTag = (t: unknown) => String(t || '').replace(/[^A-Z0-9-]/gi, '').slice(0, 12);
export const fileBase = (kit: Kit, c: Cfg, tag: string) => `OFS-T_${safeTag(tag) ? safeTag(tag) + '_' : ''}${c.design}_${kit.D(c.design)!.fixed ? 'original' : c.c1 + '-' + c.c2}_door`;

export function saveFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.hidden = true; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export async function moldPNG(kit: Kit, c: Cfg, W = 6000) {
  const svg = moldSVG(kit, c, { width: W });
  const img = new Image(), src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    img.src = src; await img.decode();
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Math.round(W * (MOLD as any).h / (MOLD as any).w);
    cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'));
    if (!blob) throw new Error('encode');
    return blob;
  } finally { URL.revokeObjectURL(src); }
}
export const svgBlob = (kit: Kit, c: Cfg) => new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + moldSVG(kit, c, { cut: true, width: 1000 })], { type: 'image/svg+xml' });
