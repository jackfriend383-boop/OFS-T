# OFS/T website: React + Vite

The same site as the original static version (pt-PT at the root, English under `/en/`, live configurator, cart, orders admin),
rebuilt as a React app and prerendered to static HTML, so search engines and the first paint still get complete pages.

```bash
npm install
npm run dev        # http://localhost:5173, hot reload
npm run build      # type-check, bundle, prerender every route into dist/
npm run preview    # serve dist/ on http://localhost:4173
```

## Layout

```
src/
  main.tsx, entry-server.tsx   client (hydrates the prerendered HTML) and server entry points
  App.tsx, state.tsx           route -> page switch; language, cart, dialogs, toast, announcements
  seo.ts                       per-page <head>: title, canonical, hreflang, Open Graph, JSON-LD
  content.ts                   page copy for home / shop / configurator / admin / 404 (pt + en)
  content/{pt,en}/*.html       long prose pages (about, privacy, terms, refunds, cookies)
  data/designs.json, site.json designs, prices, business details, order API address (same files as before)
  i18n/{pt,en}.json            UI strings (same files as before)
  lib/                         kit (data helpers), car (SVG renderer + live stage), backend (Cloudflare Worker API), mold, motion
  components/, pages/          React components
  styles/site.css              the original stylesheet, unchanged apart from the font paths
scripts/prerender.mjs          renders every route, writes sitemap.xml, fixes the site URL in robots.txt / llms.txt
```

## Editing

- Designs, prices, colours: `src/data/designs.json`; Portuguese tags and colour names in `src/i18n/pt.json`; artwork in `src/lib/car.ts` (`ART`).
- Business details and the optional order backend address (`apiUrl`): `src/data/site.json`.
- Prose pages: edit the HTML in `src/content/pt/` and `src/content/en/` (keep both in step; `{{root}}` is the language root).
- Interactive page text: `src/content.ts`; interface strings: `src/i18n/*.json`.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` (at the repository root) builds the site and publishes `dist/`. In the repository settings, set
**Pages -> Source** to **GitHub Actions**. The workflow sets the base path and canonical URLs from the repository name; for a custom domain
set `VITE_BASE=/` and `VITE_SITE_URL=https://your-domain` there.

## Other files

- `brand/` logos and icons (the ones the site uses are copied into `public/assets/img/`).
- `worker/` Cloudflare Worker + D1 database for online orders (`worker/schema.sql`; setup steps: `guides/CLOUDFLARE-SETUP.md`).
- `guides/LEGAL-TODO.md` placeholders and legal wording to complete before launch.
- `SECURITY.md` security notes and headers to set if you add a CDN.