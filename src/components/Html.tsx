import { useNavigate } from 'react-router';
import type { MouseEvent } from 'react';
import { useApp } from '../state';
import SITE from '../data/site.json';

const BASE = import.meta.env.BASE_URL; // "/" or "/<repo>/"

/* The few HTML entities that appear in our own translation strings. */
export const dec = (s: string) => s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');

/* Trader details for the footer (src/data/site.json); unfilled [PLACEHOLDERS] are shown translated. */
export function bizValues(ph: Record<string, string>) {
  const v = (s: string) => ph[s] ?? s, a = SITE.address;
  return {
    biz_legal: v(SITE.legalName), biz_nif: v(SITE.nif), biz_street: v(a.street), biz_postcode: v(a.postcode), biz_city: v(a.city),
    biz_country: v(a.country), biz_email: v(SITE.email), biz_trading: v(SITE.tradingName || SITE.name),
  } as Record<string, string>;
}

/* Trusted markup from our own page files and translation JSON (never user input): rendered as-is, with {{root}} / {{lroot}}
   filled in and in-site links handled by the router instead of a full page load. */
export function Html({ html, as: Tag = 'div', ...rest }: { html: string; as?: any } & Record<string, any>) {
  const { lang } = useApp();
  const navigate = useNavigate();
  const root = BASE + (lang === 'en' ? 'en/' : '');
  const out = html.replace(/\{\{(?:root|lroot)\}\}/g, root);
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || !u.pathname.startsWith(BASE)) return;
    e.preventDefault();
    navigate('/' + u.pathname.slice(BASE.length) + u.search + u.hash);
  };
  return <Tag {...rest} onClick={onClick} dangerouslySetInnerHTML={{ __html: out }} />;
}
