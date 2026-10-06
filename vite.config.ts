import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import site from './src/data/site.json';

/* Optional order backend (the Cloudflare Worker in worker/). Refuses anything that is not a plain origin and puts that
   origin into the Content-Security-Policy of every page. No secret ever belongs in site.json. */
function apiOrigin(): string {
  const url = (site.apiUrl || '').trim().replace(/\/$/, '');
  if (!url) return '';
  let u: URL;
  try { u = new URL(url); } catch { throw new Error(`apiUrl is not a valid URL (got ${url}).`); }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if ((u.protocol !== 'https:' && !(local && u.protocol === 'http:')) || !/^[a-z0-9.-]+$/.test(u.hostname) || u.pathname !== '/' || u.search || u.hash || u.username)
    throw new Error(`apiUrl must look like https://ofst-api.YOUR-SUBDOMAIN.workers.dev (got ${url}).`);
  return u.origin;
}

function htmlVars(): Plugin {
  const connect = apiOrigin();
  return {
    name: 'ofst-html-vars',
    transformIndexHtml: (html) => html
      .replace('__CSP_CONNECT__', connect ? ` ${connect}` : '')
      .replace(/__THEME_DARK__/g, site.themeColorDark)
      .replace(/__THEME_LIGHT__/g, site.themeColorLight),
  };
}

export default defineConfig({
  // GitHub project pages live under /<repo>/: the deploy workflow sets VITE_BASE=/<repo>/.
  base: process.env.VITE_BASE || '/',
  plugins: [react(), htmlVars()],
  build: {
    target: 'es2022',
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules') ? 'vendor' : undefined),
      },
    },
  },
});
