/* About, privacy, terms, refunds, cookies: long-form pages kept as HTML fragments (src/content/<lang>/<page>.html), so the copy
   stays easy to edit and review. Rendered at build time for SEO. The about page also gets the smooth FAQ.
   Speed: in the browser each fragment is its own small file, fetched only for the page that shows it (main.tsx fetches the
   current page's one before the page starts, so the prerendered text never flashes). The prerender fetches them all first. */
import { useEffect, useRef, useState } from 'react';
import { Html } from '../components/Html';
import { useApp } from '../state';
import { useFaq } from '../lib/motion';
import type { Lang } from '../lib/kit';

const key = (lang: Lang, page: string) => `../content/${lang}/${page}.html`;
const files = import.meta.glob('../content/*/{about,privacy,terms,refunds,cookies}.html', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
const cache: Record<string, string> = {};

/* The fragment if it is already here ('' otherwise). */
export const proseHtml = (lang: Lang, page: string) => cache[key(lang, page)] ?? '';
/* Fetch a fragment (once). */
export async function loadProse(lang: Lang, page: string) {
  const k = key(lang, page);
  if (cache[k] === undefined && files[k]) cache[k] = await files[k]();
  return cache[k] ?? '';
}
/* Prerender: every fragment, fetched before any page is rendered. */
export const loadAllProse = () => Promise.all(Object.keys(files).map(async (k) => { cache[k] = await files[k](); }));

export default function Prose({ page }: { page: string }) {
  const { lang } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const html = proseHtml(lang, page);
  const [, setLoaded] = useState(0);
  // Arriving through a link inside the site: fetch the text, then show it.
  useEffect(() => { if (!html) loadProse(lang, page).then(() => setLoaded((n) => n + 1)).catch(() => {}); }, [lang, page, html]);
  useFaq(ref, page + lang + (html ? ':ready' : ''));
  return <Html html={html} ref={ref} />;
}
