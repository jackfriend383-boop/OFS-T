/* Build of the owner's dashboard only (admin-app/), deployed on its own host (https://admin.ofstdesigns.com, Cloudflare Pages).
   It shares src/ with the public site but ships none of the public pages, and the public site no longer contains the dashboard.
   Output: dist-admin/ (+ robots.txt that blocks crawlers and _headers with strict security headers for Cloudflare Pages). */
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { apiOrigin, htmlVars } from './vite.shared';

function adminHosting(): Plugin {
  let out = '';
  return {
    name: 'ofst-admin-hosting',
    apply: 'build',
    configResolved(c) { out = join(c.root, c.build.outDir); },
    async closeBundle() {
      const api = apiOrigin();
      await writeFile(join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
      await writeFile(join(out, '_headers'), [
        '/*',
        '  Content-Security-Policy: default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; font-src \'self\'; connect-src \'self\'' + (api ? ' ' + api : '') + '; object-src \'none\'; base-uri \'self\'; form-action \'self\'; frame-ancestors \'none\'',
        '  X-Frame-Options: DENY',
        '  X-Content-Type-Options: nosniff',
        '  Referrer-Policy: no-referrer',
        '  X-Robots-Tag: noindex, nofollow',
        '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
        '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
        '',
      ].join('\n'));
      // The English view lives at /en/. Ship a real copy of the page there so Cloudflare serves it as a plain file
      // (no _redirects rules: Cloudflare flags SPA rewrites on this host as an infinite loop).
      await mkdir(join(out, 'en'), { recursive: true });
      await copyFile(join(out, 'index.html'), join(out, 'en', 'index.html'));
      // Public-site files that make no sense on the dashboard host.
      for (const f of ['CNAME', 'llms.txt']) await rm(join(out, f), { force: true });
    },
  };
}

export default defineConfig({
  root: 'admin-app',
  publicDir: '../public',
  base: '/',
  plugins: [react(), htmlVars(), adminHosting()],
  server: { fs: { allow: ['..'] } },
  build: {
    outDir: '../dist-admin',
    emptyOutDir: true,
    target: 'es2022',
    cssMinify: true,
    rollupOptions: { output: { manualChunks: (id) => (id.includes('node_modules') ? 'vendor' : undefined) } },
  },
});
