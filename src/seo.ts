/* Per-page <head>: title, description, canonical, hreflang alternates, Open Graph, JSON-LD. Used at build time (prerender)
   and on client-side navigation, so both always agree. */
import DATA from './data/designs.json';
import SITE from './data/site.json';
import { I18N, getKit, pagePath, type Lang, type PageKey } from './lib/kit';
import { proseHtml } from './pages/Prose';
import { POSTER_PHOTO } from './lib/car';

export const SITE_URL: string = String(import.meta.env.VITE_SITE_URL || SITE.SITE_URL).replace(/\/$/, '');
const BRAND = SITE.name;
const OG_W = 1200, OG_H = 630;
const LANGS: Lang[] = ['pt', 'en'];
export type SeoKey = PageKey | '404';

const e = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const abs = (path: string) => SITE_URL + path; // path starts with "/"
export const pageUrl = (lang: Lang, key: SeoKey) => (key === '404' ? abs('/404.html') : abs(pagePath(lang, key)));

function meta(key: SeoKey, lang: Lang) {
  const kit = getKit(lang);
  const m = I18N[lang].pages[key] as Record<string, string>;
  const vars: Record<string, string> = { brand: BRAND, count: String(kit.DESIGNS.length), min: kit.money(Math.min(...kit.DESIGNS.map((d) => d.price))) };
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.replace(/\{(\w+)\}/g, (x, n) => vars[n] ?? x)])) as Record<string, string>;
}

function faqItems(html: string) {
  const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
  return [...html.matchAll(/<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g)].map((m) => [strip(m[1]), strip(m[2])]);
}

function jsonld(key: SeoKey, lang: Lang, title: string) {
  const L = I18N[lang], kit = getKit(lang), b = L.build;
  const orgId = `${SITE_URL}/#organization`, siteId = `${SITE_URL}/#website`, url = pageUrl(lang, key);
  const graph: any[] = [
    { '@type': 'Organization', '@id': orgId, name: BRAND, url: `${SITE_URL}/`, logo: { '@type': 'ImageObject', url: abs('/assets/img/icons/OFST-icon-white-on-black-512px.png'), width: 512, height: 512 }, description: b.org_description },
    { '@type': 'WebSite', '@id': siteId, name: BRAND, url: `${SITE_URL}/`, inLanguage: LANGS.map((l) => I18N[l].hreflang), publisher: { '@id': orgId } },
    { '@type': 'WebPage', '@id': url + '#webpage', url, name: title, inLanguage: L.hreflang, isPartOf: { '@id': siteId } },
  ];
  const crumb = meta(key, lang).crumb;
  if (crumb) graph.push({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: b.home, item: abs(pagePath(lang, 'home')) }, { '@type': 'ListItem', position: 2, name: crumb, item: url }] });
  if (key === 'shop') {
    graph.push({
      '@type': 'ItemList', name: b.item_list, numberOfItems: kit.DESIGNS.length,
      itemListElement: kit.DESIGNS.map((d, n) => ({
        '@type': 'ListItem', position: n + 1,
        item: {
          '@type': 'Product', name: b.product_name.replace('{name}', d.name), sku: d.id, category: d.catName,
          description: b.product_desc.replace('{name}', d.name).replace('{tag}', d.tag), brand: { '@type': 'Brand', name: BRAND },
          offers: { '@type': 'Offer', price: d.price.toFixed(2), priceCurrency: DATA.currency, availability: 'https://schema.org/InStock', url: abs(`${pagePath(lang, 'configurator')}?design=${d.id}`), seller: { '@id': orgId } },
        },
      })),
    });
  }
  if (key === 'about') {
    const qa = faqItems(proseHtml(lang, 'about'));
    if (qa.length) graph.push({ '@type': 'FAQPage', inLanguage: L.hreflang, mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 1).replace(/<\//g, '<\\/');
}

/* Everything that goes in <head> for a page, as an HTML string. Elements carry data-h so a client-side navigation can swap them. */
export function headHtml(key: SeoKey, lang: Lang): string {
  const L = I18N[lang], m = meta(key, lang), canonical = pageUrl(lang, key);
  const noindex = key === '404' || key === 'order' || key === 'account';
  const alts = [...LANGS.map((l) => [I18N[l].hreflang, pageUrl(l, key)]), ['x-default', pageUrl('pt', key)]];
  const og = abs('/assets/img/og-image.png');
  const t = (s: string) => `<meta data-h ${s}>`;
  return [
    // Home hero and configurator: the car photo is the biggest thing on screen, so fetch it first (it is in the HTML, inside an SVG).
    key === 'home' || key === 'configurator' ? `<link data-h rel="preload" as="image" href="${POSTER_PHOTO}" fetchpriority="high">` : '',
    `<title data-h>${e(m.title)}</title>`,
    t(`name="description" content="${e(m.description)}"`),
    noindex ? t(`name="robots" content="${key === 'order' || key === 'account' ? 'noindex,nofollow' : 'noindex'}"`) : '',
    `<link data-h rel="canonical" href="${canonical}">`,
    ...(key === '404' ? [] : alts.map(([h, u]) => `<link data-h rel="alternate" hreflang="${h}" href="${u}">`)),
    t('property="og:type" content="website"'), t(`property="og:site_name" content="${e(BRAND)}"`), t(`property="og:locale" content="${L.locale}"`),
    ...LANGS.filter((l) => l !== lang).map((l) => t(`property="og:locale:alternate" content="${I18N[l].locale}"`)),
    t(`property="og:title" content="${e(m.title)}"`), t(`property="og:description" content="${e(m.description)}"`), t(`property="og:url" content="${canonical}"`),
    t(`property="og:image" content="${og}"`), t(`property="og:image:width" content="${OG_W}"`), t(`property="og:image:height" content="${OG_H}"`),
    t(`property="og:image:alt" content="${e(L.build.logo_alt.replace('{brand}', BRAND))}"`),
    t('name="twitter:card" content="summary_large_image"'), t(`name="twitter:title" content="${e(m.title)}"`), t(`name="twitter:description" content="${e(m.description)}"`), t(`name="twitter:image" content="${og}"`),
    `<script data-h type="application/ld+json">\n${jsonld(key, lang, m.title)}\n</script>`,
  ].filter(Boolean).join('\n');
}

/* Client-side navigation: swap the managed head elements. */
export function applyHead(key: SeoKey, lang: Lang) {
  document.head.querySelectorAll('[data-h]').forEach((el) => el.remove());
  document.head.insertAdjacentHTML('beforeend', headHtml(key, lang));
}
