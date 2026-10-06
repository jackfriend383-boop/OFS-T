/* Build helpers shared by vite.config.ts (public site) and vite.admin.config.ts (admin.ofstdesigns.com). */
import type { Plugin } from 'vite';
import site from './src/data/site.json';

/* Optional order backend (the Cloudflare Worker in worker/). Refuses anything that is not a plain origin and puts that
   origin into the Content-Security-Policy of every page. No secret ever belongs in site.json. */
export function apiOrigin(): string {
  const url = (site.apiUrl || '').trim().replace(/\/$/, '');
  if (!url) return '';
  let u: URL;
  try { u = new URL(url); } catch { throw new Error(`apiUrl is not a valid URL (got ${url}).`); }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if ((u.protocol !== 'https:' && !(local && u.protocol === 'http:')) || !/^[a-z0-9.-]+$/.test(u.hostname) || u.pathname !== '/' || u.search || u.hash || u.username)
    throw new Error(`apiUrl must look like https://ofst-api.YOUR-SUBDOMAIN.workers.dev (got ${url}).`);
  return u.origin;
}

export function htmlVars(): Plugin {
  const connect = apiOrigin();
  return {
    name: 'ofst-html-vars',
    transformIndexHtml: (html) => html
      .replace('__CSP_CONNECT__', connect ? ` ${connect}` : '')
      .replace(/__THEME_DARK__/g, site.themeColorDark)
      .replace(/__THEME_LIGHT__/g, site.themeColorLight),
  };
}
