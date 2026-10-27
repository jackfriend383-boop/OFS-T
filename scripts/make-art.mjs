/* One-off tool: makes the ready-to-use preview artwork files (the pictures drawn on the car in the configurator) from the
   print masters in src/data/masters/*.svg, so the preview is exactly what is printed. Run it again only when a master changes.

     npx -y playwright@1.56.0 install chromium   (once, if Chromium is not installed)
     node scripts/make-art.mjs

   It needs Playwright (not a project dependency: it is only used here, never by the site or the build).
   Output in public/assets/img: art-<design>-<w>.png at 1000 px (phones) and 1600 px wide, the whole sheet (74.6 x 28.5 cm).
   - Recolourable designs (masters with data-slot="c1"/"c2"): a tone mask. Black stays black, white = pure blue, first colour =
     pure red, second colour = pure green; the car recolours it with a colour-matrix filter (car.ts toneMatrix).
   - Fixed-colour designs: full colour.
   The cut line layer is left out; the base colour fills only inside the cut outlines, so the ring-shaped gap around the door's middle piece is transparent (the car shows through).
   Edit DESIGNS below to add a design. (Designs added in the admin "Designs" tab make their own previews in the browser.) */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import('playwright').catch(() => { console.error('Playwright is needed: run "npx -y playwright@1.56.0 install chromium" and "npm i --no-save playwright@1.56.0" first.'); process.exit(1); });
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESIGNS = [{ id: 'flame', master: 'flame-camo.svg', mode: 'mask' }, { id: 'stealth', master: 'flame-stealth.svg', mode: 'rgb', base: '#333333' }];
const WIDTHS = [1000, 1600];
const SHEET = [746, 285]; // mm, the master's sheet (without bleed)

function prepare(svg, d) {
  // The base colour is drawn only inside the cut outlines (even-odd, so the ring-shaped gap around the door's middle piece stays empty/transparent).
  const cut = (svg.match(/<g id="CutContour"[\s\S]*?<\/g>/) || [''])[0];
  const outline = [...cut.matchAll(/<path[^>]*? d="([^"]+)"/g)].map((m) => m[1]).join(' ');
  let s = svg.replace(/<g id="CutContour"[\s\S]*?<\/g>\s*(?=<\/svg>)/, '');
  if (d.mode === 'mask') {
    s = s.replace(/(<path[^>]*data-slot="c1"[^>]*?)fill="#[0-9A-Fa-f]{6}"/, '$1fill="#FF0000"')
      .replace(/(<path[^>]*data-slot="c2"[^>]*?)fill="#[0-9A-Fa-f]{6}"/, '$1fill="#00FF00"')
      .replace(/fill="#FFFFFF"/gi, 'fill="#0000FF"').replace(/stroke="#FFFFFF"/gi, 'stroke="#0000FF"');
  }
  const base = d.mode === 'mask' ? '#FF0000' : d.base;
  const baseShape = outline ? `<path d="${outline}" fill="${base}" fill-rule="evenodd"/>` : `<rect x="-5" y="-5" width="${SHEET[0] + 10}" height="${SHEET[1] + 10}" fill="${base}"/>`;
  // The art is also clipped at the cut outlines: the printed bleed (5 mm past the cut) would otherwise narrow the gap in the preview.
  const clip = outline ? `<clipPath id="cutclip"><path d="${outline}" clip-rule="evenodd"/></clipPath>` : '';
  s = s.replace('<g id="Artwork">', `${clip}<g id="Artwork"${outline ? ' clip-path="url(#cutclip)"' : ''}>${baseShape}`);
  return s;
}

const browser = await chromium.launch();
for (const d of DESIGNS) {
  const svg = prepare(await readFile(join(ROOT, 'src/data/masters', d.master), 'utf8'), d);
  for (const w of WIDTHS) {
    const h = Math.round(w * SHEET[1] / SHEET[0]);
    const body = svg.replace(/<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET[0]} ${SHEET[1]}" width="${w}" height="${h}" shape-rendering="geometricPrecision">`);
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.setContent(`<body style="margin:0;background:transparent">${body.replace(/^<\?xml[^>]*>\s*/, '')}</body>`);
    const out = join(ROOT, 'public/assets/img', `art-${d.id}-${w}.png`);
    await writeFile(out, await page.screenshot({ type: "png", omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } }));
    console.log('wrote', out); await page.close();
  }
}
await browser.close();
