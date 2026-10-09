import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import App from './App';
import { headHtml, SITE_URL, pageUrl, type SeoKey } from './seo';
import { langOfPath, pageOfPath, PAGE_KEYS, pagePath, I18N, type Lang } from './lib/kit';

/* Renders one route to static HTML (used by scripts/prerender.mjs). `url` is an app path such as "/en/shop/". */
export function render(url: string) {
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '');
  const html = renderToString(
    <StaticRouter location={basename + url} basename={basename || undefined}>
      <App />
    </StaticRouter>,
  );
  const lang = langOfPath(url);
  const page = pageOfPath(url);
  return { html, head: headHtml((page ?? '404') as SeoKey, lang), lang, htmlLang: I18N[lang].hreflang as string };
}

export const routes = (['pt', 'en'] as Lang[]).flatMap((l) => PAGE_KEYS.map((k) => ({ lang: l, key: k, path: pagePath(l, k) })));
export { SITE_URL, pageUrl, PAGE_KEYS, pagePath };
export { loadAllProse } from './pages/Prose';
