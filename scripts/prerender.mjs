/* Prerender: renders every route to static HTML (so search engines and first paint get the full page), then writes the
   sitemap and rewrites the site URL in robots.txt / llms.txt. Runs after `vite build` and `vite build --ssr`. */
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const ssrDir = join(root, 'dist-ssr');
const site = JSON.parse(await readFile(join(root, 'src/data/site.json'), 'utf8'));

const { render, routes, SITE_URL, pageUrl, loadAllProse } = await import(pathToFileURL(join(ssrDir, 'entry-server.js')).href);
await loadAllProse(); // the long text pages are separate files: load them before rendering
const template = await readFile(join(dist, 'index.html'), 'utf8');

const page = (url) => {
  const { html, head, htmlLang } = render(url);
  return template
    .replace('<html lang="pt-PT">', `<html lang="${htmlLang}">`)
    .replace('<!--head-->', () => head)
    .replace('<!--app-->', () => html);
};
const write = async (rel, text) => { const f = join(dist, rel); await mkdir(dirname(f), { recursive: true }); await writeFile(f, text); };

let n = 0;
for (const r of routes) {
  await write(join(r.path.replace(/^\//, ''), 'index.html'), page(r.path));
  n++;
}
// One 404 page for the whole site (GitHub Pages serves /404.html for every missing path): Portuguese with an English line.
await write('404.html', page('/404.html'));

/* sitemap.xml: public pages in both languages, with hreflang alternates. */
const PUBLIC = routes.filter((r) => !['order', 'account'].includes(r.key));
const prio = { home: '1.0', shop: '0.9', configurator: '0.9', about: '0.7' };
const byKey = Object.groupBy(PUBLIC, (r) => r.key);
const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'];
for (const r of PUBLIC) {
  const alts = byKey[r.key];
  const loc = pageUrl(r.lang, r.key);
  xml.push('  <url>', `    <loc>${loc}</loc>`, `    <lastmod>${site.lastmod}</lastmod>`, `    <priority>${prio[r.key] ?? '0.4'}</priority>`);
  for (const a of alts) xml.push(`    <xhtml:link rel="alternate" hreflang="${a.lang === 'pt' ? 'pt-PT' : 'en'}" href="${pageUrl(a.lang, a.key)}"/>`);
  xml.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl('pt', r.key)}"/>`, '  </url>');
}
xml.push('</urlset>', '');
await write('sitemap.xml', xml.join('\n'));

/* The placeholder address in the copied text files becomes the real one. */
for (const f of ['robots.txt', 'llms.txt']) {
  const p = join(dist, f);
  try { await writeFile(p, (await readFile(p, 'utf8')).replaceAll(site.SITE_URL.replace(/\/$/, ''), SITE_URL)); } catch { /* file not present */ }
}
await rm(ssrDir, { recursive: true, force: true });
console.log(`prerendered ${n + 1} pages for ${SITE_URL}`);
