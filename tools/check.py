#!/usr/bin/env python3
"""Static checks over the built site in docs/.

    python tools/check.py

For every docs/**/*.html: exactly one <h1>, unique <title>, absolute canonical, og:image, <html lang> matching the folder
(pt-PT at the root, en under en/), hreflang alternates for pt-PT, en and x-default (self-referencing, x-default = pt-PT),
no untranslated key UI strings (English ones on Portuguese pages and vice versa),
alt on every <img>, JSON-LD parses, no inline executable <script>, no inline on* handlers,
and every relative (or site-absolute) href/src resolves to a file in docs/.
Accessibility (static markup only; JS-rendered parts are not seen): buttons and links have an accessible name,
form fields have a label, ids are unique, aria-labelledby/-describedby/-controls point at existing ids,
headings don't skip levels going down, target=_blank links carry rel=noopener, one <main>, skip link to it.
Also: assets/js/i18n.js has the same JS dictionary keys in both languages.
Exits 1 on failure.
"""
from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse, unquote

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / 'docs'
SITE = json.loads((ROOT / 'src' / 'data' / 'site.json').read_text(encoding='utf-8'))
BASE_PATH = urlparse(SITE['SITE_URL']).path.rstrip('/') + '/'
DATA_SCRIPT_TYPES = {'application/ld+json', 'application/json'}
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}
NAMED = {'button', 'a', 'label', 'summary'}          # elements whose text content we collect
FIELD_SKIP = {'hidden', 'submit', 'button', 'image', 'reset'}
HREFLANGS = {'pt-PT', 'en', 'x-default'}
# Key UI strings that must not leak into the other language (searched in visible text and attribute values).
LEAKS = {
    'pt-PT': ['Add to cart', 'Checkout', 'Your cart', 'Open cart', 'Close cart', 'Search designs', 'Skip to content', 'Quick add',
              'Customize', 'Switch to light theme', 'View cart', 'Back to designs', 'All designs', 'Terms of sale', 'Privacy policy',
              'Refunds &amp; returns', 'Refunds & returns', 'Last updated', 'One side', 'Light tone', 'Original colours', 'Filter by category'],
    'en': ['Adicionar ao carrinho', 'Finalizar compra', 'O seu carrinho', 'Abrir carrinho', 'Fechar carrinho', 'Pesquisar designs',
           'Saltar para o conteúdo', 'Personalizar', 'Mudar para o tema', 'Ver carrinho', 'Voltar aos designs', 'Todos os designs',
           'Condições de venda', 'Política de privacidade', 'Reembolsos e devoluções', 'Última atualização', 'Um lado', 'Tom claro',
           'Cores originais', 'Filtrar por categoria'],
}


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.h1 = 0
        self.title = ''
        self.in_title = False
        self.lang = None
        self.alternates = []      # (hreflang, href)
        self.canonical = []
        self.og_image = None
        self.imgs_without_alt = []
        self.handlers = []
        self.inline_scripts = []
        self.jsonld = []
        self.refs = []
        self._script = None
        self._buf = []
        # a11y
        self.ids = {}
        self.dup_ids = []
        self.idrefs = []          # (attr, tag, id)
        self.stack = []           # open NAMED elements: dict(tag, attrs, text, line)
        self.unnamed = []
        self.fields = []          # (tag, attrs, inside_label, line)
        self.label_for = set()
        self.blank_no_rel = []
        self.headings = []
        self.mains = 0
        self.skip_link = False
        self._svg_depth = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        line = self.getpos()[0]
        for k, _ in attrs:
            if k.lower().startswith('on'):
                self.handlers.append(f'<{tag} {k}>')
        if 'id' in a:
            if a['id'] in self.ids:
                self.dup_ids.append(f'id="{a["id"]}" (lines {self.ids[a["id"]]} and {line})')
            else:
                self.ids[a['id']] = line
        for k in ('aria-labelledby', 'aria-describedby', 'aria-controls'):
            for ref in (a.get(k) or '').split():
                self.idrefs.append((k, tag, ref, line))
        if tag == 'html':
            self.lang = a.get('lang')
        elif tag == 'h1':
            self.h1 += 1
        elif tag == 'title':
            self.in_title = True
        elif tag == 'link' and a.get('rel') == 'canonical':
            self.canonical.append(a.get('href', ''))
        elif tag == 'link' and a.get('rel') == 'alternate' and a.get('hreflang'):
            self.alternates.append((a['hreflang'], a.get('href', '')))
        elif tag == 'meta' and a.get('property') == 'og:image':
            self.og_image = a.get('content')
        elif tag == 'img':
            if 'alt' not in a:
                self.imgs_without_alt.append(a.get('src'))
            elif a['alt'].strip():
                for el in self.stack:
                    el['text'] += ' ' + a['alt']
        elif tag == 'script':
            self._script = a
            self._buf = []
        elif tag == 'main':
            self.mains += 1
        elif tag in ('input', 'select', 'textarea'):
            if not (tag == 'input' and (a.get('type') or 'text').lower() in FIELD_SKIP):
                self.fields.append((tag, a, any(el['tag'] == 'label' for el in self.stack), line))
        elif tag == 'label' and a.get('for'):
            self.label_for.add(a['for'])
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.headings.append((int(tag[1]), line))
        if tag == 'a':
            if (a.get('target') or '').lower() == '_blank' and 'noopener' not in (a.get('rel') or '').lower().split() \
                    and 'noreferrer' not in (a.get('rel') or '').lower().split():
                self.blank_no_rel.append(f'line {line}: {a.get("href")}')
            if a.get('href') == '#main' and 'skip' in (a.get('class') or ''):
                self.skip_link = True
        if tag == 'svg':
            self._svg_depth += 1
        # a labelled descendant (e.g. <svg role="img" aria-label>) names its parent button/link
        if a.get('aria-label') and a.get('aria-hidden') != 'true' and tag not in NAMED:
            for el in self.stack:
                el['text'] += ' ' + a['aria-label']
        if tag in NAMED and tag not in VOID:
            self.stack.append({'tag': tag, 'attrs': a, 'text': '', 'line': line})
        for k in ('href', 'src'):
            if a.get(k) is not None:
                self.refs.append((tag, k, a[k]))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag in NAMED:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
        elif tag == 'script' and self._script is not None:
            body = ''.join(self._buf).strip()
            t = (self._script.get('type') or '').lower()
            if 'src' not in self._script:
                if t == 'application/ld+json':
                    self.jsonld.append(body)
                elif t not in DATA_SCRIPT_TYPES:
                    self.inline_scripts.append(body[:60])
            elif body:
                self.inline_scripts.append('src script with inline body: ' + body[:60])
            self._script = None
        elif tag == 'svg':
            self._svg_depth = max(0, self._svg_depth - 1)
        if tag in NAMED:
            for i in range(len(self.stack) - 1, -1, -1):
                if self.stack[i]['tag'] == tag:
                    el = self.stack.pop(i)
                    a = el['attrs']
                    named = el['text'].strip() or (a.get('aria-label') or '').strip() or a.get('aria-labelledby') or (a.get('title') or '').strip()
                    if tag in ('button', 'a') and not named and a.get('aria-hidden') != 'true':
                        if tag == 'a' and 'href' not in a:
                            break
                        self.unnamed.append(f'<{tag}> at line {el["line"]} ({" ".join(f"{k}={v}" for k, v in list(a.items())[:3])})')
                    break

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if self._script is not None:
            self._buf.append(data)
        elif data.strip():
            for el in self.stack:
                el['text'] += data


def resolve(page: Path, ref: str):
    """Return the docs/ file a reference points at, or None if it isn't a local reference."""
    u = urlparse(ref)
    if u.scheme or ref.startswith('//') or ref.startswith('#') or ref.startswith('data:'):
        return None
    path = unquote(u.path)
    if path == '':
        return page  # "?query" or "#frag" on the same page
    if path.startswith('/'):
        if not path.startswith(BASE_PATH):
            return DOCS / '__outside_base_path__' / path.lstrip('/')
        target = DOCS / path[len(BASE_PATH):]
    else:
        target = (page.parent / path)
    if path.endswith('/') or target.is_dir():
        target = target / 'index.html'
    return target.resolve()


def main():
    errors = []
    titles = {}
    pages = sorted(DOCS.rglob('*.html'))
    if not pages:
        print('No HTML files in docs/. Run tools/build.py first.')
        return 1
    for f in pages:
        rel = f.relative_to(DOCS).as_posix()
        p = Page()
        p.feed(f.read_text(encoding='utf-8'))
        err = lambda m: errors.append(f'{rel}: {m}')
        if p.h1 != 1:
            err(f'expected exactly one <h1>, found {p.h1}')
        t = p.title.strip()
        if not t:
            err('missing <title>')
        elif t in titles:
            err(f'duplicate <title> "{t}" (also {titles[t]})')
        else:
            titles[t] = rel
        want = 'en' if rel.startswith('en/') else 'pt-PT'
        if p.lang != want:
            err(f'<html lang> is {p.lang!r}, expected {want!r}')
        if len(p.canonical) != 1 or not p.canonical[0].startswith(('https://', 'http://')):
            err(f'canonical missing, duplicated or not absolute: {p.canonical}')
        # ---- languages ----
        alts = dict(p.alternates)
        if set(alts) != HREFLANGS or len(p.alternates) != len(HREFLANGS):
            err(f'hreflang alternates should be exactly {sorted(HREFLANGS)}, found {[h for h, _ in p.alternates]}')
        else:
            if not all(u.startswith(('https://', 'http://')) for u in alts.values()):
                err(f'hreflang alternates must be absolute URLs: {alts}')
            if p.canonical and alts.get(p.lang) != p.canonical[0]:
                err(f'hreflang="{p.lang}" ({alts.get(p.lang)}) does not match the canonical ({p.canonical[0]})')
            if alts['x-default'] != alts['pt-PT']:
                err('hreflang="x-default" must point to the pt-PT page')
        src = f.read_text(encoding='utf-8')
        # Ignore JSON-LD, comments and explicitly English/Portuguese snippets (lang="..." on an element, e.g. the 404 English line).
        scan = re.sub(r'<script\b.*?</script>|<!--.*?-->', ' ', src, flags=re.S)
        scan = re.sub(r'<(\w+)[^>]*\blang="(?!' + re.escape(p.lang or '') + r'")[^"]*"[^>]*>.*?</\1>', ' ', scan, flags=re.S)
        for s in LEAKS.get(p.lang, []):
            if s in scan:
                err(f'untranslated UI string {s!r} on a {p.lang} page')
        if not p.og_image or not p.og_image.startswith(('https://', 'http://')):
            err(f'og:image missing or not absolute: {p.og_image!r}')
        for s in p.imgs_without_alt:
            err(f'<img src="{s}"> has no alt')
        for h in p.handlers:
            err(f'inline event handler {h}')
        for s in p.inline_scripts:
            err(f'inline executable script: {s!r}')
        if not p.jsonld:
            err('no JSON-LD block')
        for block in p.jsonld:
            try:
                json.loads(block)
            except ValueError as ex:
                err(f'JSON-LD does not parse: {ex}')
        for tag, attr, ref in p.refs:
            target = resolve(f, ref)
            if target is not None and not target.is_file():
                err(f'<{tag} {attr}="{ref}"> does not resolve to a file ({target})')
        # ---- accessibility ----
        for d in p.dup_ids:
            err(f'duplicate {d}')
        for k, tag, ref, line in p.idrefs:
            if ref not in p.ids:
                err(f'<{tag} {k}="{ref}"> at line {line}: no element with that id')
        for u in p.unnamed:
            err(f'no accessible name: {u}')
        for tag, a, in_label, line in p.fields:
            fid = a.get('id')
            if not (in_label or (fid and fid in p.label_for) or a.get('aria-label') or a.get('aria-labelledby') or a.get('title')):
                err(f'<{tag} id="{fid}"> at line {line} has no label')
        for b in p.blank_no_rel:
            err(f'target=_blank without rel=noopener: {b}')
        if p.mains != 1:
            err(f'expected exactly one <main>, found {p.mains}')
        elif 'main' not in p.ids:
            err('<main> has no id="main" (skip link target)')
        if not p.skip_link:
            err('no skip link (<a class="skip" href="#main">)')
        prev = 0
        for level, line in p.headings:
            if prev and level > prev + 1:
                err(f'heading level jumps from h{prev} to h{level} at line {line}')
            prev = level
    # ---- JS dictionary: same keys in every language ----
    i18n = DOCS / 'assets' / 'js' / 'i18n.js'
    if not i18n.is_file():
        errors.append('assets/js/i18n.js missing')
    else:
        m = re.search(r'const ALL = (\{.*?\});\n', i18n.read_text(encoding='utf-8'), re.S)
        try:
            dicts = json.loads(m.group(1).replace('<\\/', '</')) if m else None
        except ValueError:
            dicts = None
        if not dicts:
            errors.append('assets/js/i18n.js: dictionary not found or does not parse')
        else:
            keys = {l: set(d['js']) for l, d in dicts.items()}
            for l, ks in keys.items():
                for o, ko in keys.items():
                    for k in sorted(ko - ks):
                        errors.append(f'assets/js/i18n.js: "{k}" is in {o} but missing in {l}')
    n = len(pages)
    if errors:
        print(f'FAIL: {len(errors)} problem(s) in {n} pages')
        for m in errors:
            print('  ' + m)
        return 1
    print(f'OK: {n} pages checked ({", ".join(p.relative_to(DOCS).as_posix() for p in pages)})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
