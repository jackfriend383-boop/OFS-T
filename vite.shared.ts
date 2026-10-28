/* Build helpers shared by vite.config.ts (public site) and vite.admin.config.ts (admin.ofstdesigns.com). */
import type { Plugin } from 'vite';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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

/* Writes dist/_headers for the public site. Cloudflare Pages and Netlify apply it; GitHub Pages cannot set response headers and
   serves it as an inert file. Same policy as the <meta> CSP plus the parts a meta tag cannot carry (frame-ancestors, HSTS...). */
export function securityHeaders(): Plugin {
  let out = '';
  return {
    name: 'ofst-security-headers',
    apply: 'build',
    configResolved(c) { out = resolve(c.root, c.build.outDir); },
    async closeBundle() {
      const api = apiOrigin();
      await writeFile(join(out, '_headers'), [
        '/*',
        '  Content-Security-Policy: default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:' + (api ? ' ' + api : '') + '; font-src \'self\'; connect-src \'self\'' + (api ? ' ' + api : '') + '; object-src \'none\'; base-uri \'self\'; form-action \'self\'; frame-ancestors \'none\'; upgrade-insecure-requests',
        '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
        '  X-Content-Type-Options: nosniff',
        '  X-Frame-Options: DENY',
        '  Referrer-Policy: strict-origin-when-cross-origin',
        '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()',
        '  Cross-Origin-Opener-Policy: same-origin',
        '',
      ].join('\n'));
    },
  };
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
