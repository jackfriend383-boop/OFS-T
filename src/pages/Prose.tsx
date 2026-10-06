/* About, privacy, terms, refunds, cookies: long-form pages kept as HTML fragments (src/content/<lang>/<page>.html), so the copy
   stays easy to edit and review. Rendered at build time for SEO. The about page also gets the smooth FAQ. */
import { useRef } from 'react';
import { Html } from '../components/Html';
import { useApp } from '../state';
import { useFaq } from '../lib/motion';
import type { Lang } from '../lib/kit';

const files = import.meta.glob('../content/*/*.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
export const proseHtml = (lang: Lang, page: string) => files[`../content/${lang}/${page}.html`] ?? '';

export default function Prose({ page }: { page: string }) {
  const { lang } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  useFaq(ref, page + lang);
  return <Html html={proseHtml(lang, page)} ref={ref} />;
}
