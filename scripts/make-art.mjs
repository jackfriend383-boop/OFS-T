/* One-off tool: makes the ready-to-use signature artwork files from the supplied door art, so the browser no longer has to
   process pixels on every visit. Run it again only if public/assets/img/flame-red.webp or flame-stealth.webp change.

     npx -y playwright@1.56.0 install chromium   (once, if Chromium is not installed)
     node scripts/make-art.mjs

   It needs Playwright (not a project dependency: it is only used here, never by the site or the build). Output, next to the
   source files: art-flame-<w>.png (tone mask: black, white, light tone = red, dark tone = green, recoloured on the car by a
   colour-matrix filter) and art-stealth-<w>.webp (full colour), at 1000 px (phones) and 1600 px wide, each with the badge
   cut-out and registration mark filled in from the surrounding artwork. The steps are exactly the ones the site used to run
   in the browser (car.ts prepareArt), run here in Chromium so the result is identical.
   The shipped PNGs were then re-saved as 4-colour palette PNGs (pixel-identical, about 4x smaller), e.g. with Python Pillow:
   Image.open(f).convert('RGB').quantize(4, method=Image.Quantize.MAXCOVERAGE, dither=Image.Dither.NONE).save(f, optimize=True) */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import('playwright').catch(() => { console.error('Playwright is needed: run "npx -y playwright@1.56.0 install chromium" and "npm i --no-save playwright@1.56.0" first.'); process.exit(1); });
const IMG = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'public/assets/img');
const SRC = {
  flame: { img: 'flame-red.webp', mode: 'mask', size: [2000, 846], outer: [1068, 193, 1885, 657, 120], inner: [1165, 265, 1718, 594, 140], mark: [1588, 532, 46] },
  stealth: { img: 'flame-stealth.webp', mode: 'rgb', size: [2000, 859], outer: [1071, 204, 1872, 662, 120], inner: [1163, 274, 1711, 602, 140], mark: [1603, 562, 46] },
};
const WIDTHS = [1000, 1600];

/* Runs in the page: the former prepareArt, without the caching. Returns the encoded file as base64. */
async function prepare({ S, url, k }) {
  const inRR = (x, y, [x0, y0, x1, y1, r]) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const img = new Image(); img.src = url; await img.decode();
  const w = Math.round(S.size[0] * k), h = Math.round(S.size[1] * k), N = w * h;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h), d = id.data;
  // 1. Badge cut-out ring and registration mark = holes to fill.
  const hole = new Uint8Array(N), [mx, my, mr] = S.mark;
  const mark = (x0, y0, x1, y1, test) => {
    const ya = Math.max(0, Math.floor(y0 * k)), yb = Math.min(h - 1, Math.ceil(y1 * k)), xa = Math.max(0, Math.floor(x0 * k)), xb = Math.min(w - 1, Math.ceil(x1 * k));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) if (test(x / k, y / k)) hole[y * w + x] = 1;
  };
  mark(S.outer[0], S.outer[1], S.outer[2], S.outer[3], (sx, sy) => inRR(sx, sy, S.outer) && !inRR(sx, sy, S.inner));
  mark(mx - mr, my - mr, mx + mr, my + mr, (sx, sy) => (sx - mx) ** 2 + (sy - my) ** 2 < mr * mr);
  // 2. Tone labels: 0 black, 1 white, 2 light tone, 3 dark tone; isolated edge pixels take their neighbours' label.
  let lab = null;
  if (S.mode === 'mask') {
    lab = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], mx_ = Math.max(r, g, b), mn = Math.min(r, g, b);
      lab[i] = mx_ - mn < 60 ? (r + g + b > 384 ? 1 : 0) : (mx_ >= 204 ? 2 : 3);
    }
    const out = lab.slice(), cnt = new Uint8Array(4);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x; cnt.fill(0);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) cnt[lab[i + dy * w + dx]]++;
      if (cnt[lab[i]] < 3) { let best = 0; for (let q2 = 1; q2 < 4; q2++) if (cnt[q2] > cnt[best]) best = q2; out[i] = best; }
    }
    lab = out;
  }
  // 3. Fill holes by growing the surrounding shapes inwards (nearest pixel wins).
  const from = new Int32Array(N).fill(-1), queue = new Int32Array(N); let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) if (!hole[i]) { from[i] = i; const x = i % w; if ((x > 0 && hole[i - 1]) || (x < w - 1 && hole[i + 1]) || (i >= w && hole[i - w]) || (i + w < N && hole[i + w])) queue[qt++] = i; }
  const grow = (i, j) => { if (from[j] < 0) { from[j] = from[i]; queue[qt++] = j; } };
  while (qh < qt) { const i = queue[qh++], x = i % w; if (x > 0) grow(i, i - 1); if (x < w - 1) grow(i, i + 1); if (i >= w) grow(i, i - w); if (i + w < N) grow(i, i + w); }
  const TONE = [[0, 0, 0], [0, 0, 255], [255, 0, 0], [0, 255, 0]];
  for (let i = 0; i < N; i++) {
    const s = from[i] < 0 ? i : from[i];
    if (lab) { const t = TONE[lab[s]]; d[i * 4] = t[0]; d[i * 4 + 1] = t[1]; d[i * 4 + 2] = t[2]; }
    else if (s !== i) { d[i * 4] = d[s * 4]; d[i * 4 + 1] = d[s * 4 + 1]; d[i * 4 + 2] = d[s * 4 + 2]; }
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  // Tone masks stay lossless (PNG); full-colour art is WebP at the same quality the site used.
  const blob = await new Promise((r) => c.toBlob(r, S.mode === 'mask' ? 'image/png' : 'image/webp', .92));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage();
await page.route('http://art.local/**', async (r) => r.fulfill({ body: await readFile(join(IMG, new URL(r.request().url()).pathname.slice(1))), contentType: 'image/webp' }));
await page.goto('http://art.local/flame-red.webp');
for (const [key, S] of Object.entries(SRC)) for (const W of WIDTHS) {
  const b64 = await page.evaluate(prepare, { S, url: 'http://art.local/' + S.img, k: W / 2000 });
  const out = join(IMG, `art-${key}-${W}.${S.mode === 'mask' ? 'png' : 'webp'}`);
  await writeFile(out, Buffer.from(b64, 'base64'));
  console.log('wrote', out, Math.round(b64.length * 0.75 / 1024) + ' KB');
}
await browser.close();
