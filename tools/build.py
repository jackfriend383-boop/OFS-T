#!/usr/bin/env python3
"""Build the OFS/T static site into docs/ (GitHub Pages).

    python tools/build.py

Inputs
  src/data/site.json        SITE_URL, brand name, default description, lastmod
  src/data/designs.json     colours, categories, designs, featured + hero lists (single source of truth)
  src/templates/base.html   shared document shell (head, header, footer, drawer, search, toast)
  src/i18n/{pt,en}.json     UI strings per language (template, meta, JSON-LD, llms.txt, JS dictionary -> assets/js/i18n.js)
  src/pages/pt/*.html       Portuguese page bodies (default language, site root)
  src/pages/*.html          English page bodies (under /en/); {{placeholders}} are filled here
  assets/                   css / js / img, copied verbatim
  brand/                    favicon + icon PNGs (copied), og-image source

Outputs (docs/ is wiped and fully regenerated, so the build is idempotent)
  pages (pt-PT at the root, English under en/), assets/js/data.js (generated from designs.json), assets/js/i18n.js, favicon.ico, icons, og-image.png,
  site.webmanifest, robots.txt, sitemap.xml, llms.txt, .nojekyll

Standard library only.
"""
from __future__ import annotations

import html
import json
import re
import shutil
import struct
import sys
import zlib
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'
OUT = ROOT / 'docs'

SITE = json.loads((SRC / 'data' / 'site.json').read_text(encoding='utf-8'))
DATA = json.loads((SRC / 'data' / 'designs.json').read_text(encoding='utf-8'))

SITE_URL = SITE['SITE_URL'].rstrip('/')
BASE_PATH = urlparse(SITE_URL).path.rstrip('/') + '/'          # e.g. "/ofst-website/" (used by 404.html)
BRAND = SITE['name']
LASTMOD = SITE['lastmod']
COLORS = DATA['colors']
DESIGNS = DATA['designs']
CATS = DATA['cats']
EXTRA = DATA['extras']
D = {d['id']: d for d in DESIGNS}


def supabase_config():
    """Optional order backend (see SUPABASE-SETUP.md). Returns (origin, public key) or ('', '') when not configured.
    Refuses anything that is not a public anon/publishable key, so a service_role/secret key can never be published."""
    url = (SITE.get('supabaseUrl') or '').strip().rstrip('/')
    key = (SITE.get('supabaseAnonKey') or '').strip()
    if not url and not key:
        return '', ''
    if not url or not key:
        sys.exit('build: set both supabaseUrl and supabaseAnonKey in src/data/site.json, or leave both empty.')
    u = urlparse(url)
    if (u.scheme != 'https' or not u.hostname or not re.fullmatch(r'[a-z0-9.-]+', u.hostname) or u.path or u.query
            or u.fragment or u.port or u.username):
        sys.exit(f'build: supabaseUrl must look like https://YOURPROJECT.supabase.co (got {url!r}).')
    if not re.fullmatch(r'[A-Za-z0-9._-]+', key):
        sys.exit('build: supabaseAnonKey contains unexpected characters.')
    if key.startswith('sb_secret_'):
        sys.exit('build: supabaseAnonKey is a SECRET key. Use the anon / publishable key; never publish a secret key.')
    if key.count('.') == 2:  # legacy JWT key: check its role claim
        import base64
        try:
            part = key.split('.')[1]
            role = json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4))).get('role')
        except (ValueError, AttributeError):
            role = None
        if role != 'anon':
            sys.exit(f'build: supabaseAnonKey has role {role!r}. Only the "anon" public key may be used; never the service_role key.')
    elif not key.startswith('sb_publishable_'):
        sys.exit('build: supabaseAnonKey is not a Supabase anon (eyJ...) or publishable (sb_publishable_...) key.')
    return f'https://{u.hostname}', key


SB_ORIGIN, SB_KEY = supabase_config()

OG_W, OG_H = 1200, 630
OG_IMAGE = f'{SITE_URL}/assets/img/og-image.png'
ICON_DIR = ROOT / 'brand' / 'white-on-black'
ICONS = {32: 'OFST-icon-white-on-black-32px.png', 180: 'OFST-icon-white-on-black-180px.png',
         192: 'OFST-icon-white-on-black-192px.png', 512: 'OFST-icon-white-on-black-512px.png'}

# Thumbnail placeholder: same viewBox (aspect ratio) as the JS thumbnail, so nothing shifts when car.js fills it in.
PH_THUMB = '<svg class="car-svg" viewBox="556 272 1032 594" aria-hidden="true"></svg>'

written: list[str] = []

# --------------------------------------------------------------------------- languages
# pt-PT is the default language and lives at the site root; English lives under /en/. Both share /assets/.
# UI strings: src/i18n/<lang>.json. Page bodies: src/pages/pt/<page>.html (Portuguese) and src/pages/<page>.html (English).
LANGS = ['pt', 'en']
DEFAULT_LANG = 'pt'
I18N = {l: json.loads((SRC / 'i18n' / f'{l}.json').read_text(encoding='utf-8')) for l in LANGS}
PAGE_DIR = {'pt': SRC / 'pages' / 'pt', 'en': SRC / 'pages'}


def tr(lang: str, section: str, key: str, **kw) -> str:
    """A build-time string from src/i18n/<lang>.json, with {name} fields filled in."""
    s = I18N[lang][section][key]
    return s.format(**kw) if kw else s


def price(v, lang: str) -> str:
    """Matches Intl.NumberFormat(lang, {style:'currency', currency:'EUR', maximumFractionDigits:0}) in assets/js/i18n.js."""
    return I18N[lang]['price'].replace('{v}', str(v))


def cat_name(c, lang):
    return I18N[lang]['cats'].get(c, c)


def color_name(k, lang):
    return I18N[lang]['colors'].get(k, COLORS[k]['name'])


def tag_of(d, lang):
    return I18N[lang]['tags'].get(d['id'], d['tag'])


# --------------------------------------------------------------------------- pages
NAV = [('home', ''), ('shop', 'shop/'), ('configurator', 'configurator/'), ('about', 'about/')]

PAGES = [
    dict(key='home', src='home.html', path='', nav='home', scripts=['car.js', 'home.js'], preload=['ami-side.webp']),
    dict(key='shop', src='shop.html', path='shop/', nav='shop', scripts=['car.js', 'shop.js'], preload=['ami-side.webp']),
    dict(key='configurator', src='configurator.html', path='configurator/', nav='configurator', scripts=['car.js', 'configurator.js'], preload=['ami-side.webp']),
    dict(key='about', src='about.html', path='about/', nav='about', scripts=[]),
    dict(key='privacy', src='privacy.html', path='privacy/', nav=None, scripts=[]),
    dict(key='terms', src='terms.html', path='terms/', nav=None, scripts=[]),
    dict(key='refunds', src='refunds.html', path='refunds/', nav=None, scripts=[]),
    dict(key='cookies', src='cookies.html', path='cookies/', nav=None, scripts=[]),
    # One 404 page for the whole site (GitHub Pages serves /404.html for every missing path): Portuguese with an English line.
    dict(key='404', src='404.html', path='404.html', nav=None, scripts=[], noindex=True, langs=['pt']),
    # Owner-only orders dashboard: not in nav, footer, sitemap or llms.txt (noindex), never indexed or followed.
    dict(key='admin', src='admin.html', path='admin/', nav=None, scripts=['car.js', 'mold-data.js', 'admin.js'], noindex=True, robots='noindex,nofollow'),
]

e = html.escape


def fill(text: str, values: dict, name: str, strict: bool = True) -> str:
    def rep(m):
        k = m.group(1)
        if k not in values:
            if not strict:
                return m.group(0)
            raise KeyError(f'{name}: no value for {{{{{k}}}}}')
        return str(values[k])
    return re.sub(r'\{\{([a-z0-9_]+)\}\}', rep, text)


def meta(page, lang):
    m = I18N[lang]['pages'][page['key']]
    kw = dict(brand=BRAND, count=len(DESIGNS), min=price(min(d['price'] for d in DESIGNS), lang))
    return {k: v.format(**kw) for k, v in m.items()}


def colour_label(c, lang):
    d = D[c['design']]
    return tr(lang, 'build', 'original_colours') if d.get('fixed') else f"{color_name(c['c1'], lang)} / {color_name(c['c2'], lang)}"


def card_html(d, lroot, lang):
    n = e(d['name'])
    return (f'<article class="dcard" data-id="{e(d["id"])}" data-cat="{e(d["cat"])}"><div class="mini" data-thumb="{e(d["id"])}">{PH_THUMB}</div>\n'
            f'  <div class="dcard-row"><h3>{n}</h3><span class="price">{price(d["price"], lang)}</span></div>\n'
            f'  <div class="dcard-row"><span class="tag">{e(tag_of(d, lang))}</span><span class="eyebrow">{e(cat_name(d["cat"], lang))}</span></div>\n'
            f'  <div class="dcard-actions"><a class="btn btn-primary" data-act="custom" href="{lroot}configurator/?design={e(d["id"])}" aria-label="{e(tr(lang, "build", "customize_aria", name=d["name"]))}">{e(tr(lang, "build", "customize"))}</a>'
            f'<button class="btn btn-ghost" type="button" data-act="add" aria-label="{e(tr(lang, "build", "quick_add_aria", name=d["name"]))}">{e(tr(lang, "build", "quick_add"))}</button></div></article>')


def tabs_html(lang):
    """Category filter: a group of toggle buttons (aria-pressed), not ARIA tabs. data-c stays the English key."""
    return ''.join(f'<button type="button" aria-pressed="{"true" if i == 0 else "false"}" data-c="{e(c)}">{e(cat_name(c, lang))}</button>' for i, c in enumerate(CATS))


def swatches_html(selected, lang):
    """Colour swatches: role=radio inside a role=radiogroup row, roving tabindex (only the checked one is tabbable)."""
    return ''.join(
        f'<button type="button" class="sw" style="--c:{c["hex"]}" data-k="{e(k)}" role="radio" aria-checked="{"true" if k == selected else "false"}" '
        f'tabindex="{"0" if k == selected else "-1"}" title="{e(color_name(k, lang))}" aria-label="{e(color_name(k, lang))}"></button>'
        for k, c in COLORS.items())


def page_values(page, lroot, lang):
    """Pre-rendered dynamic parts of the page bodies. {{root}} in a page body is the root of its language (page links)."""
    v = {'root': lroot, 'design_count': len(DESIGNS), 'x_second': EXTRA['secondSide'], 'x_badge': EXTRA['badge'],
         'x_second_fmt': price(EXTRA['secondSide'], lang), 'x_badge_fmt': price(EXTRA['badge'], lang)}
    if page['key'] == 'home':
        hero = DATA['heroCycle']
        v['hero_name'] = e(D[hero[0]]['name'])
        v['hero_cat'] = e(cat_name(D[hero[0]]['cat'], lang))
        v['hero_dots'] = ''.join(f'<button type="button" aria-label="{e(D[i]["name"])}" aria-pressed="{"true" if n == 0 else "false"}" data-i="{n}"></button>' for n, i in enumerate(hero))
        v['featured_cards'] = '\n'.join(card_html(D[i], lroot, lang) for i in DATA['featured'])
    if page['key'] == 'shop':
        v['shop_tabs'] = tabs_html(lang)
        v['shop_cards'] = '\n'.join(card_html(d, lroot, lang) for d in DESIGNS)
    if page['key'] == 'configurator':
        d = DESIGNS[0]
        cfg = {'design': d['id'], 'c1': d['c1'], 'c2': d['c2']}
        tones = d.get('art') == 'flame'
        b = lambda k, **kw: tr(lang, 'build', k, **kw)
        v.update(d_name=e(d['name']), d_cat=e(cat_name(d['cat'], lang)), d_tag=e(tag_of(d, lang)), d_price=d['price'], d_price_fmt=price(d['price'], lang),
                 c1_label=b('light_tone') if tones else b('primary'), c2_label=b('dark_tone') if tones else b('accent'),
                 c1_name=e(color_name(d['c1'], lang)), c2_name=e(color_name(d['c2'], lang)),
                 sw_hidden=' hidden' if d.get('fixed') else '', fixed_hidden='' if d.get('fixed') else ' hidden',
                 sum_sub=e(f'Ami QuickSilver · {colour_label(cfg, lang)} · {b("matte")}'),
                 sum_lines=f'<li class=""><span>{e(b("kit_one_side", name=d["name"]))}</span><span>{price(d["price"], lang)}</span></li>',
                 cfg_tabs=tabs_html(lang))
        for slot in ('c1', 'c2'):
            v[f'{slot}_swatches'] = swatches_html(d[slot], lang)
        v['strip_cards'] = '\n'.join(
            f'<button type="button" class="pcard" data-id="{e(x["id"])}" data-cat="{e(x["cat"])}" aria-pressed="{"true" if x is d else "false"}"><span class="mini" data-thumb="{e(x["id"])}">{PH_THUMB}</span>'
            f'<b>{e(x["name"])}</b><small><span>{e(tag_of(x, lang))}</span><span class="price">{price(x["price"], lang)}</span></small></button>'
            for x in DESIGNS)
    return v


def abs_url(path: str) -> str:
    return f'{SITE_URL}/{path}'


def page_url(page, lang) -> str:
    return abs_url('404.html') if page['key'] == '404' else abs_url(I18N[lang]['prefix'] + page['path'])


def faq_items(body: str):
    out = []
    for q, a in re.findall(r'<details[^>]*>\s*<summary>(.*?)</summary>\s*<p>(.*?)</p>\s*</details>', body, re.S):
        strip = lambda s: html.unescape(re.sub(r'<[^>]+>', '', s)).strip()
        out.append((strip(q), strip(a)))
    return out


def jsonld(page, body, lang, title):
    L = I18N[lang]
    b = lambda k, **kw: tr(lang, 'build', k, **kw)
    org_id = f'{SITE_URL}/#organization'
    site_id = f'{SITE_URL}/#website'
    url = page_url(page, lang)
    graph = [
        {'@type': 'Organization', '@id': org_id, 'name': BRAND, 'url': f'{SITE_URL}/',
         'logo': {'@type': 'ImageObject', 'url': abs_url('assets/img/icons/' + ICONS[512]), 'width': 512, 'height': 512},
         'description': b('org_description')},
        {'@type': 'WebSite', '@id': site_id, 'name': BRAND, 'url': f'{SITE_URL}/',
         'inLanguage': [I18N[l]['hreflang'] for l in LANGS], 'publisher': {'@id': org_id}},
        {'@type': 'WebPage', '@id': url + '#webpage', 'url': url, 'name': title, 'inLanguage': L['hreflang'], 'isPartOf': {'@id': site_id}},
    ]
    crumb = meta(page, lang).get('crumb')
    if crumb:
        graph.append({'@type': 'BreadcrumbList', 'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': b('home'), 'item': abs_url(L['prefix'])},
            {'@type': 'ListItem', 'position': 2, 'name': crumb, 'item': url}]})
    if page['key'] == 'shop':
        graph.append({'@type': 'ItemList', 'name': b('item_list'), 'numberOfItems': len(DESIGNS), 'itemListElement': [
            {'@type': 'ListItem', 'position': n, 'item': {
                '@type': 'Product', 'name': b('product_name', name=d['name']), 'sku': d['id'], 'category': cat_name(d['cat'], lang),
                'description': b('product_desc', name=d['name'], tag=tag_of(d, lang)),
                'brand': {'@type': 'Brand', 'name': BRAND},
                'offers': {'@type': 'Offer', 'price': f'{d["price"]:.2f}', 'priceCurrency': DATA['currency'],
                           'availability': 'https://schema.org/InStock', 'url': abs_url(f'{L["prefix"]}configurator/?design={d["id"]}'),
                           'seller': {'@id': org_id}}}}
            for n, d in enumerate(DESIGNS, 1)]})
    if page['key'] == 'about':
        qa = faq_items(body)
        assert qa, f'about page ({lang}): no FAQ <details> found'
        graph.append({'@type': 'FAQPage', 'inLanguage': L['hreflang'], 'mainEntity': [
            {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in qa]})
    doc = {'@context': 'https://schema.org', '@graph': graph}
    text = json.dumps(doc, ensure_ascii=False, indent=1).replace('</', '<\\/')
    return f'<script type="application/ld+json">\n{text}\n</script>'


def business_values(lang):
    """Trader details for the footer, from src/data/site.json, so the owner edits them in one place.
    Unfilled [PLACEHOLDERS] are shown translated (src/i18n/<lang>.json "placeholders")."""
    ph = I18N[lang].get('placeholders', {})
    v = lambda s: e(ph.get(s, s))
    a = SITE.get('address', {})
    return {'biz_legal': v(SITE.get('legalName', '')), 'biz_nif': v(SITE.get('nif', '')), 'biz_street': v(a.get('street', '')),
            'biz_postcode': v(a.get('postcode', '')), 'biz_city': v(a.get('city', '')), 'biz_country': v(a.get('country', '')),
            'biz_email': v(SITE.get('email', '')), 'biz_trading': v(SITE.get('tradingName', BRAND))}


def lang_links(page, root, lang, cls):
    """PT | EN switch: links to the same page in each language (core.js adds the query string / configurator state)."""
    out = []
    for l in LANGS:
        L = I18N[l]
        if page['key'] == '404':
            href = root + L['prefix']
        else:
            href = (root + L['prefix'] + page['path']) or './'
        cur = ' aria-current="true"' if l == lang else ''
        out.append(f'<a href="{href}" hreflang="{L["hreflang"]}" lang="{L["hreflang"]}" data-lang="{l}"{cur}>{L["short"]}<span class="sr"> {L["label"]}</span></a>')
    sep = '<span class="sep" aria-hidden="true">|</span>' if cls == 'lang' else ''
    return f'<div class="{cls}" role="group" aria-label="{e(I18N[lang]["ui"]["t_lang_label"])}">{sep.join(out)}</div>'


def build_page(page, base, lang):
    L = I18N[lang]
    is404 = page['key'] == '404'
    rel = '404.html' if is404 else L['prefix'] + page['path']
    depth = rel.count('/')
    root = BASE_PATH if is404 else '../' * depth   # site root: shared assets
    lroot = root + L['prefix']                      # language root: page links
    home_href = lroot or './'
    body_src = (PAGE_DIR[lang] / page['src']).read_text(encoding='utf-8')
    body = fill(body_src, page_values(page, lroot, lang), f'{lang}/{page["src"]}')
    m = meta(page, lang)

    def nav_links():
        out = []
        for key, href in NAV:
            target = (lroot + href) or './'
            cur = ' aria-current="page"' if page['nav'] == key else ''
            out.append(f'<a href="{target}" data-r="{key}"{cur}>{e(L["nav"][key])}</a>')
        return out

    alts = [(I18N[l]['hreflang'], page_url(page, l)) for l in LANGS] + [('x-default', page_url(page, DEFAULT_LANG))]
    scripts = ['data.js', 'i18n.js', 'config.js', 'backend.js', 'core.js', 'motion.js'] + page['scripts']
    canonical = page_url(page, lang)
    values = {
        'html_lang': L['hreflang'],
        'title': e(m['title']), 'description': e(m['description']), 'canonical': canonical,
        'alternates': '\n'.join(f'<link rel="alternate" hreflang="{h}" href="{u}">' for h, u in alts),
        'robots': f'<meta name="robots" content="{page.get("robots", "noindex")}">\n' if page.get('noindex') else '',
        'csp_connect': f' {SB_ORIGIN}' if SB_ORIGIN else '',
        'theme_dark': SITE['themeColorDark'], 'theme_light': SITE['themeColorLight'],
        'og_type': 'website', 'site_name': e(BRAND), 'locale': L['locale'],
        'locale_alt': '\n'.join(f'<meta property="og:locale:alternate" content="{I18N[l]["locale"]}">' for l in LANGS if l != lang),
        'og_title': e(m['title']), 'og_image': OG_IMAGE, 'og_image_w': OG_W, 'og_image_h': OG_H,
        'og_image_alt': e(tr(lang, 'build', 'logo_alt', brand=BRAND)),
        'root': root, 'lroot': lroot, 'home_href': home_href,
        'nav': '\n'.join('    ' + a for a in nav_links()),
        'mnav': ''.join(nav_links()),
        'lang_switch': lang_links(page, root, lang, 'lang'),
        'mlang_switch': lang_links(page, root, lang, 'mlang'),
        'content': body.rstrip('\n'),
        'jsonld': jsonld(page, body, lang, m['title']),
        # Pages with a live car or thumbnails preload the car photo (and the hero/opening artwork) so car.js finds them cached.
        'scripts': '\n'.join([f'<link rel="preload" as="image" href="{root}assets/img/{p}" type="image/webp">' for p in page.get('preload', [])]
                             + [f'<script src="{root}assets/js/{s}" defer></script>' for s in scripts]),
        **business_values(lang),
    }
    # Two passes: UI strings first (they may contain {{lroot}} / {{biz_*}}), then everything else.
    out = fill(fill(base, L['ui'], 'base.html', strict=False), values, 'base.html')
    write(OUT / rel if is404 else OUT / (rel + 'index.html'), out)
    return page


def i18n_js():
    """assets/js/i18n.js: the JS dictionaries of both languages, picked at runtime by <html lang>, plus a localised
    copy of the design data (tags, category and colour names). Loaded right after data.js, before everything else."""
    all_ = {l: {'locale': I18N[l]['intl'], 'js': I18N[l]['js'], 'cats': I18N[l]['cats'], 'colors': I18N[l]['colors'], 'tags': I18N[l]['tags']}
            for l in LANGS}
    blob = json.dumps(all_, ensure_ascii=False, indent=1).replace('</', '<\\/')
    return ('/* Generated by tools/build.py from src/i18n/*.json. Do not edit. */\n'
            '(() => {\n\'use strict\';\n'
            f'const ALL = {blob};\n'
            r"""const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const lang = /^en\b/i.test(document.documentElement.lang || '') ? 'en' : 'pt';
const L = ALL[lang], EN = ALL.en;
const fmt = (s, v) => v ? String(s).replace(/\{(\w+)\}/g, (m, k) => has(v, k) ? v[k] : m) : s;
/* T('key', {name:'x'}) -> string in the page language (English as fallback); T.n('key', n) picks key_one / key_other. */
const T = (k, v) => fmt(has(L.js, k) ? L.js[k] : has(EN.js, k) ? EN.js[k] : k, v);
T.n = (k, n, v) => T(k + (n === 1 ? '_one' : '_other'), Object.assign({n}, v));
T.raw = k => has(L.js, k) ? L.js[k] : EN.js[k];
T.lang = lang; T.locale = L.locale;
let nf0 = null, nf2 = null;
try {
  nf0 = new Intl.NumberFormat(L.locale, {style:'currency', currency:'EUR', minimumFractionDigits:0, maximumFractionDigits:0});
  nf2 = new Intl.NumberFormat(L.locale, {style:'currency', currency:'EUR', minimumFractionDigits:2, maximumFractionDigits:2});
} catch(e) {}
/* Euro amounts: whole euros without decimals ("€69" / "69 €"), otherwise two decimals. */
T.price = v => { v = +v || 0; const f = Number.isInteger(v) ? nf0 : nf2; return f ? f.format(v) : (lang === 'en' ? '€' + v : v + ' €'); };
T.cat = c => has(L.cats, c) ? L.cats[c] : c;
/* Localise the design data in place: tags and colour names; d.catName is the label, d.cat stays the filter key. */
const DATA = window.OFST_DATA;
if(DATA && Array.isArray(DATA.designs) && DATA.colors){
  DATA.designs.forEach(d => { if(has(L.tags, d.id)) d.tag = L.tags[d.id]; d.catName = T.cat(d.cat); });
  Object.keys(DATA.colors).forEach(k => { if(has(L.colors, k)) DATA.colors[k].name = L.colors[k]; });
}
window.OFST_T = T;
})();
""")


# --------------------------------------------------------------------------- PNG (pure python)
def png_read(path: Path):
    """Decode a non-interlaced 8-bit PNG (grey, RGB, palette, grey+alpha, RGBA) to (w, h, rows of RGBA bytes)."""
    raw = path.read_bytes()
    assert raw[:8] == b'\x89PNG\r\n\x1a\n', path
    pos, idat, plte, trns = 8, b'', None, None
    while pos < len(raw):
        n, typ = struct.unpack('>I4s', raw[pos:pos + 8])
        chunk = raw[pos + 8:pos + 8 + n]
        pos += 12 + n
        if typ == b'IHDR':
            w, h, bd, ct, _, _, il = struct.unpack('>IIBBBBB', chunk)
        elif typ == b'PLTE':
            plte = chunk
        elif typ == b'tRNS':
            trns = chunk
        elif typ == b'IDAT':
            idat += chunk
        elif typ == b'IEND':
            break
    if bd != 8 or il != 0:
        raise ValueError(f'{path}: only 8-bit non-interlaced PNGs are supported (bit depth {bd}, interlace {il})')
    bpp = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    data = zlib.decompress(idat)
    stride = w * bpp
    prev = bytearray(stride)
    rows = []
    p = 0
    for _ in range(h):
        f = data[p]
        line = bytearray(data[p + 1:p + 1 + stride])
        p += 1 + stride
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        prev = line
        # to RGBA
        if ct == 6:
            rgba = bytes(line)
        elif ct == 2:
            rgba = bytearray(w * 4)
            rgba[0::4], rgba[1::4], rgba[2::4] = line[0::3], line[1::3], line[2::3]
            rgba[3::4] = b'\xff' * w
        elif ct == 0:
            rgba = bytearray(w * 4)
            rgba[0::4] = rgba[1::4] = rgba[2::4] = line
            rgba[3::4] = b'\xff' * w
        elif ct == 4:
            rgba = bytearray(w * 4)
            rgba[0::4] = rgba[1::4] = rgba[2::4] = line[0::2]
            rgba[3::4] = line[1::2]
        else:  # palette
            rgba = bytearray(w * 4)
            for x, idx in enumerate(line):
                rgba[x * 4:x * 4 + 3] = plte[idx * 3:idx * 3 + 3]
                rgba[x * 4 + 3] = trns[idx] if trns and idx < len(trns) else 255
        rows.append(bytes(rgba))
    return w, h, rows


def png_write(path: Path, w: int, h: int, rgb_rows):
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes(r) for r in rgb_rows)
    data = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    write(path, data)


def make_og_image(dest: Path):
    """1200×630 card: brand mark (icon + name, white) centred on the site's dark background #0B0D0E."""
    bg = (0x0B, 0x0D, 0x0E)
    src = ROOT / 'brand' / 'icon-with-name' / 'white' / 'OFST-icon-with-name-white-1024px.png'
    w, h, rows = png_read(src)
    # composite over the background, then 2× box-downsample to 512×512
    sw, sh = w // 2, h // 2
    logo = []
    for y in range(sh):
        r0, r1 = rows[2 * y], rows[2 * y + 1]
        out = bytearray(sw * 3)
        for x in range(sw):
            acc = [0, 0, 0]
            for r in (r0, r1):
                for xx in (2 * x, 2 * x + 1):
                    i = xx * 4
                    a = r[i + 3]
                    for c in range(3):
                        acc[c] += (r[i + c] * a + bg[c] * (255 - a)) // 255
            out[x * 3:x * 3 + 3] = bytes(v // 4 for v in acc)
        logo.append(out)
    ox, oy = (OG_W - sw) // 2, (OG_H - sh) // 2
    bg_row = bytes(bg) * OG_W
    canvas = []
    for y in range(OG_H):
        row = bytearray(bg_row)
        if oy <= y < oy + sh:
            row[ox * 3:(ox + sw) * 3] = logo[y - oy]
        canvas.append(row)
    png_write(dest, OG_W, OG_H, canvas)


# --------------------------------------------------------------------------- files
def write(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, str):
        path.write_text(data, encoding='utf-8', newline='\n')
    else:
        path.write_bytes(data)
    written.append(path.relative_to(OUT).as_posix())


def copy(src: Path, rel: str):
    dest = OUT / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)
    written.append(rel)


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()

    # assets (verbatim) + generated data.js
    for f in sorted((ROOT / 'assets').rglob('*')):
        if f.is_file():
            copy(f, 'assets/' + f.relative_to(ROOT / 'assets').as_posix())
    data_js = ('/* Generated by tools/build.py from src/data/designs.json. Do not edit. */\n'
               'window.OFST_DATA = ' + json.dumps(DATA, ensure_ascii=False, indent=1) + ';\n')
    write(OUT / 'assets' / 'js' / 'data.js', data_js)
    # Public runtime config for assets/js/backend.js. The anon/publishable key is public by design (RLS protects the data).
    cfg = {'supabaseUrl': SB_ORIGIN, 'supabaseAnonKey': SB_KEY, 'email': SITE.get('email', '')}
    write(OUT / 'assets' / 'js' / 'config.js', '/* Generated by tools/build.py from src/data/site.json. Do not edit. */\n'
          'window.OFST_CONFIG = ' + json.dumps(cfg, ensure_ascii=False).replace('</', '<\\/') + ';\n')

    # icons
    copy(ICON_DIR / 'favicon-white-on-black.ico', 'favicon.ico')
    for name in ICONS.values():
        copy(ICON_DIR / name, 'assets/img/icons/' + name)
    make_og_image(OUT / 'assets' / 'img' / 'og-image.png')

    # pages: every page in every language (pt-PT at the root, English under /en/)
    write(OUT / 'assets' / 'js' / 'i18n.js', i18n_js())
    base = (SRC / 'templates' / 'base.html').read_text(encoding='utf-8')
    for lang in LANGS:
        for page in PAGES:
            if lang in page.get('langs', LANGS):
                build_page(page, base, lang)

    # manifest (default language)
    manifest = {
        'name': BRAND, 'short_name': BRAND, 'description': tr(DEFAULT_LANG, 'build', 'org_description'), 'lang': I18N[DEFAULT_LANG]['hreflang'],
        'start_url': './', 'scope': './', 'display': 'standalone',
        'background_color': SITE['themeColorDark'], 'theme_color': SITE['themeColorDark'],
        'icons': [{'src': f'assets/img/icons/{ICONS[s]}', 'sizes': f'{s}x{s}', 'type': 'image/png', 'purpose': 'any'} for s in (192, 512)],
    }
    write(OUT / 'site.webmanifest', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

    # robots / sitemap / llms / nojekyll
    bots = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai',
            'Google-Extended', 'PerplexityBot', 'Perplexity-User', 'CCBot', 'Applebot-Extended', 'Bytespider', 'meta-externalagent']
    robots = '# All crawlers, including AI crawlers, may index this site.\nUser-agent: *\nAllow: /\n\n'
    robots += ''.join(f'User-agent: {b}\n' for b in bots) + 'Allow: /\n\n'
    robots += f'Sitemap: {SITE_URL}/sitemap.xml\n'
    write(OUT / 'robots.txt', robots)

    # Sitemap: every indexable page in both languages, each with its hreflang alternates (admin and 404 are noindex: left out).
    indexable = [p for p in PAGES if not p.get('noindex')]
    prio = {'home': '1.0', 'shop': '0.9', 'configurator': '0.9', 'about': '0.6'}
    sm = ['<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    for p in indexable:
        alts = ''.join(f'\n    <xhtml:link rel="alternate" hreflang="{I18N[l]["hreflang"]}" href="{e(page_url(p, l))}"/>' for l in LANGS)
        alts += f'\n    <xhtml:link rel="alternate" hreflang="x-default" href="{e(page_url(p, DEFAULT_LANG))}"/>'
        for lang in LANGS:
            sm.append(f'  <url>\n    <loc>{e(page_url(p, lang))}</loc>\n    <lastmod>{LASTMOD}</lastmod>\n    <priority>{prio.get(p["key"], "0.3")}</priority>{alts}\n  </url>')
    sm.append('</urlset>')
    write(OUT / 'sitemap.xml', '\n'.join(sm) + '\n')

    lo = min(d['price'] for d in DESIGNS)
    kw = lambda lang: dict(brand=BRAND, count=len(DESIGNS), min=price(lo, lang))
    llms = [f'# {BRAND}', '']
    for lang in ['en', 'pt']:
        llms += ['> ' + I18N[lang]['llms']['intro'].format(**kw(lang)), '']
    llms += ['Kits are outdoor vinyl, pre-cut, in matte or gloss, and fitted at home with a step-by-step guide. '
             f'Options: two vinyl colours per design (except fixed-colour artwork), matte or gloss finish, second side +€{EXTRA["secondSide"]}, custom badge text (up to 8 characters) +€{EXTRA["badge"]}. '
             f'{BRAND} is independent and not affiliated with Citroën or Stellantis.', '',
             f'The site is bilingual: European Portuguese (pt-PT, the default, at {SITE_URL}/) and English (under {SITE_URL}/en/). '
             'Both languages have the same pages, designs and prices.', '']
    for lang in ['en', 'pt']:
        Ll = I18N[lang]
        llms += [f'## {Ll["llms"]["heading"]}', '']
        llms += [f'- [{name}]({abs_url(Ll["prefix"] + dict(NAV)[key])}): {desc.format(**kw(lang))}' for key, name, desc in Ll['llms']['pages']]
        llms.append('')
    llms += ['## Designs', '']
    for d in DESIGNS:
        line = I18N['en']['llms']['design_line'].format(cat=cat_name(d['cat'], 'en'), price=price(d['price'], 'en'), tag=tag_of(d, 'en'))
        llms.append(f'- [{d["name"]}]({abs_url("en/configurator/?design=" + d["id"])}): {line} '
                    f'(Português: {abs_url("configurator/?design=" + d["id"])} — {tag_of(d, "pt")})')
    llms += ['', '## Optional', '']
    for lang in ['en', 'pt']:
        Ll = I18N[lang]
        llms += [f'- [{name}]({abs_url(Ll["prefix"] + key + "/")}): {desc}' for key, name, desc in Ll['llms']['legal']]
    llms.append('')
    write(OUT / 'llms.txt', '\n'.join(llms))
    write(OUT / '.nojekyll', '')

    print(f'Built {len(written)} files into {OUT}:')
    for w in written:
        print('  ' + w)
    if 'YOUR-USERNAME' in SITE_URL:
        print('\nNOTE: SITE_URL in src/data/site.json is still the placeholder; set it before publishing.', file=sys.stderr)


if __name__ == '__main__':
    main()
