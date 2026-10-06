# OFS/T: sticker kits for the Citroën Ami

Website and live configurator for OFS/T, pre-cut vinyl sticker kits for the Citroën Ami door panel and rear quarter window. Visitors pick a design, set colours and a finish, and preview the result on a photo of the car before ordering.

It is a static, pre-rendered site: every page is a complete HTML file, and JavaScript adds the interactive parts on top. It has no backend, trackers or third-party requests, and it runs on GitHub Pages as-is.

## Features

- Live configurator: designs are drawn onto the car photo and clipped to the real sticker areas, with an animated "squeegee" when the design changes, plus camera views, matte/gloss finish, one or both sides, and optional badge text.
- Two car versions in the configurator: the Ami QuickSilver (default, used across the site) and the Ami Pop.
- 15 designs. The three Signature ones are built from supplied artwork, and the two-tone ones can be recoloured.
- Cart stored in the visitor's browser, with a demo checkout (no payment is taken and nothing is sent).
- Bilingual: European Portuguese (pt-PT, the default, at the site root) and English (under `/en/`), with a PT | EN switch in the header and the mobile menu. The cart is shared between languages.
- Dark and light themes (follows the system setting, with a manual toggle).
- Accessible: keyboard operable, modal dialogs with focus handling, labelled controls, WCAG AA contrast, reduced-motion support.
- SEO: unique titles and descriptions per language, a canonical URL, hreflang alternates (pt-PT, en, x-default → pt-PT), Open Graph tags with locale alternates, JSON-LD (Organization, WebSite, WebPage with inLanguage, Product list, FAQ, breadcrumbs), a sitemap with both languages, robots.txt, llms.txt.

## Project layout

```
src/
  data/site.json        site URL, business details, theme colours
  data/designs.json     designs, colours, prices: the single source of truth
  i18n/pt.json, en.json UI strings per language: header/footer/nav, meta titles and descriptions, JSON-LD and
                        llms.txt text, design tags/categories/colour names, and the JS dictionary ("js")
  templates/base.html   shared <head>, header, footer, cart and search dialogs (one template for both languages)
  pages/pt/*.html       Portuguese page bodies → site root (/, /shop/, …)
  pages/*.html          English page bodies → /en/ (/en/, /en/shop/, …)
assets/
  css/site.css          all styles (self-hosted fonts at the top)
  js/                   theme-init, core (shared), car (configurator engine), home, shop, configurator, backend, admin
  img/  fonts/
tools/
  build.py              renders src/ → docs/ (Python 3 standard library only)
  check.py              validates the built pages (headings, meta, links, accessibility basics)
docs/                   the built site that GitHub Pages serves (generated, but committed)
brand/                  logo files
```

## Build and preview

You need Python 3.9 or newer. There are no dependencies.

```bash
python tools/build.py
python tools/check.py
python -m http.server 8000 --directory docs
```

Then open http://localhost:8000. The local server does not serve the custom 404 page; GitHub Pages does.

Always edit files in `src/` and `assets/`, then rebuild. Never edit `docs/` by hand, because it is regenerated on every build.

## Languages and translations

Portuguese (pt-PT) is the default language and is served at the site root; English is served under `/en/`. Both use the same
English URL slugs (`/shop/` and `/en/shop/`) and share `/assets/`. There are no automatic language redirects: the language is
chosen only by the URL (the PT | EN links keep the current page, its query string and `#fragment`; on the configurator they
carry the kit being designed).

- **Page text**: edit `src/pages/pt/<page>.html` (Portuguese) and `src/pages/<page>.html` (English). Keep the two in step,
  including the `id`s of headings (links like `refunds/#personalised` are shared). `{{root}}` in a page body is the root of
  that page's language.
- **Interface text** (header, footer, buttons, aria-labels, meta titles and descriptions, breadcrumbs, JSON-LD, llms.txt):
  `src/i18n/pt.json` and `src/i18n/en.json`. `ui` keys become `{{t_…}}` placeholders in `src/templates/base.html`.
- **Text produced by JavaScript** (cart, checkout, toast, search, configurator summary, admin, error messages): the `js`
  section of the same files. The build writes both dictionaries to `assets/js/i18n.js`; scripts call `O.T('key', {vars})`,
  and the dictionary is picked by `<html lang>`. Keys ending in `_one` / `_other` are singular/plural. Prices are formatted
  with `Intl.NumberFormat` (`€69` / `69 €`).
- **Designs**: names are brand names and stay as they are. Portuguese tags, category and colour names are in `pt.json`
  (`tags`, `cats`, `colors`), keyed by the ids in `designs.json`.
- `tools/check.py` fails if a page lacks the hreflang alternates, if `<html lang>` doesn't match the folder, if key English
  strings appear on Portuguese pages (or vice versa), or if a JS key exists in one language only.

## Deploy on GitHub Pages

1. Set `SITE_URL` in `src/data/site.json` to your real address (for example `https://your-username.github.io/ofst-website` or your own domain), then rebuild. Canonical URLs, Open Graph tags, the sitemap and the 404 page use it.
2. Commit and push.
3. On GitHub, go to **Settings → Pages → Build and deployment** and choose **Deploy from a branch**, branch `main`, folder `/docs`.
4. For a custom domain, add it under Settings → Pages. `robots.txt` and `llms.txt` only take effect at the root of a domain.

GitHub Pages cannot send custom HTTP security headers. If you put the site behind Cloudflare or Netlify, add the headers listed in [SECURITY.md](SECURITY.md).

## Before launch

- [ ] Fill in the business details in `src/data/site.json` (legal name, NIF, address, emails).
- [ ] Complete every `[PLACEHOLDER]` in the legal pages, in **both** languages (`src/pages/pt/` and `src/pages/`), and have them reviewed by a lawyer. See [LEGAL-TODO.md](LEGAL-TODO.md).
- [ ] Re-add product claims (vinyl thickness, outdoor lifetime, delivery times, shipping costs) only once they are verified. They are listed in LEGAL-TODO.md.
- [ ] Replace the demo checkout with a real payment provider, and follow the backend checklist in [SECURITY.md](SECURITY.md).
- [ ] Replace `docs/assets/img/og-image.png` (currently the logo on a dark card) with a 1200×630 image of a kit on the car. The source is generated by `tools/build.py`.
- [ ] Choose a licence for the code and artwork. All rights are reserved until you add one.

## Adding a design

Add an entry to `src/data/designs.json` (id, name, tag, category, price, default colours), and its Portuguese tag under `tags` in `src/i18n/pt.json`. Then add its artwork function to the `ART` map in `assets/js/car.js`. Artwork is drawn in photo pixel coordinates and clipped to the door and window zones. Rebuild afterwards.

## Notes

- "Citroën" and "Ami" are trademarks of their owners. OFS/T is independent and not affiliated with Citroën or Stellantis.
- Fonts: Archivo and IBM Plex Mono, self-hosted under the SIL Open Font License (see `assets/fonts/LICENSE.txt`).
