import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import site from './src/data/site.json';

/* Optional order backend. Refuses anything that is not a public anon/publishable key (same rules as the old tools/build.py),
   and puts the Supabase origin into the Content-Security-Policy of every page. */
function supabaseOrigin(): string {
  const url = (site.supabaseUrl || '').trim().replace(/\/$/, '');
  const key = (site.supabaseAnonKey || '').trim();
  if (!url && !key) return '';
  if (!url || !key) throw new Error('Set both supabaseUrl and supabaseAnonKey in src/data/site.json, or leave both empty.');
  const u = new URL(url);
  if (u.protocol !== 'https:' || !/^[a-z0-9.-]+$/.test(u.hostname) || u.pathname !== '/' || u.search || u.hash || u.port || u.username)
    throw new Error(`supabaseUrl must look like https://YOURPROJECT.supabase.co (got ${url}).`);
  if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error('supabaseAnonKey contains unexpected characters.');
  if (key.startsWith('sb_secret_')) throw new Error('supabaseAnonKey is a SECRET key. Use the anon / publishable key.');
  if (key.split('.').length === 3) {
    let role = '';
    try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch { /* checked below */ }
    if (role !== 'anon') throw new Error(`supabaseAnonKey has role "${role}". Only the "anon" public key may be used.`);
  } else if (!key.startsWith('sb_publishable_')) {
    throw new Error('supabaseAnonKey is not a Supabase anon (eyJ...) or publishable (sb_publishable_...) key.');
  }
  return `https://${u.hostname}`;
}

function htmlVars(): Plugin {
  const connect = supabaseOrigin();
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
