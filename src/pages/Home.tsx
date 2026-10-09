/* Home: beach hero with the live car that cycles through designs, the Ami version picker (opens the configurator with that
   version chosen), featured designs, how it works.
   Auto-cycling (WCAG 2.2.2): off with prefers-reduced-motion, paused while hovered, focused, off-screen or in a hidden tab,
   and stopped for good once the visitor picks a design with the dots. */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useApp } from '../state';
import { COPY } from '../content';
import { FEATURED, HERO_CYCLE } from '../lib/kit';
import { CarStage, Thumb } from '../components/Car';
import { DesignCard } from '../components/DesignCard';

const BASE = import.meta.env.BASE_URL;

/* Cut shapes of each kit piece, traced from the sticker templates (CitroenAMI.pdf / MedidasPDFAMI.pdf), drawn to scale
   inside their own box. Holes use the even-odd fill rule. */
const PIECE_SHAPES: Record<string, { vb: string; d: string }> = {
  // Door panel around the badge (74.6 × 28.5 cm): rounded panel with the badge cut-out, and the two lower strips.
  door: { vb: '0 0 300 116', d: 'M34 3C110-1 190-1 266 3C288 5 297 22 297 48C297 70 294 84 288 92H12C6 84 3 70 3 48C3 22 12 5 34 3Z'
    + 'M194 22h60a16 16 0 0 1 16 16v16a16 16 0 0 1-16 16h-60a16 16 0 0 1-16-16V38a16 16 0 0 1 16-16Z'
    + 'M10 97H146V113H26C16 113 12 106 10 97Z M154 97H290C288 106 284 113 274 113H154Z' },
  // Ami 2025 rear quarter window: wide rounded panel with softly bowed top and bottom edges.
  window: { vb: '0 0 200 110', d: 'M30 6C70 2 130 2 170 6C188 8 196 22 196 40V70C196 92 186 104 166 104C120 108 80 108 34 104C14 104 4 92 4 70V40C4 22 12 8 30 6Z' },
  // Ami Pop front accent (15.8 × 3.1 cm): two thin brackets, one per headlight.
  accent: { vb: '0 0 200 40', d: 'M8 2H192A6 6 0 0 1 198 8V17H190V10H10V17H2V8A6 6 0 0 1 8 2Z M8 38H192A6 6 0 0 0 198 32V23H190V30H10V23H2V32A6 6 0 0 0 8 38Z' },
  // Rim sticker: a ring that sits on the wheel.
  rims: { vb: '0 0 100 100', d: 'M4 50A46 46 0 1 1 96 50A46 46 0 1 1 4 50Z M22 50A28 28 0 1 0 78 50A28 28 0 1 0 22 50Z' },
};

/* One flashcard. Front: the cut shape, name and quantity. Back: size and a short line.
   Hover flips it on devices with a mouse; a tap, click, Enter or Space flips it everywhere (aria-pressed).
   Both faces stay in the page for screen readers; with reduced motion it fades instead of turning. */
function KitCard({ code, name, qty, tag, size, text, sizeLabel, qtyLabel }: { code: string; name: string; qty: string; tag: string; size: string; text: string; sizeLabel: string; qtyLabel: string }) {
  const [open, setOpen] = useState(false);
  const shape = PIECE_SHAPES[code];
  return (
    <li>
      <button type="button" className={'kc kc-' + code} aria-pressed={open} onClick={() => setOpen((o) => !o)}>
        <span className="kc-in">
          <span className="kc-face kc-front">
            <span className="kc-plate" aria-hidden="true">
              <svg viewBox={shape.vb} focusable="false"><path d={shape.d} fillRule="evenodd" /></svg>
            </span>
            <span className="kc-tag">{tag}</span>
            <span className="kc-name">{name}</span>
            <span className="kc-qty">{qty}</span>
            <span className="kc-turn" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" /></svg></span>
          </span>
          <span className="kc-face kc-back">
            <span className="kc-tag">{tag}</span>
            <span className="kc-name">{name}</span>
            <span className="kc-row"><span>{sizeLabel}</span><b>{size}</b></span>
            <span className="kc-row"><span>{qtyLabel}</span><b>{qty}</b></span>
            <span className="kc-text">{text}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

export default function Home() {
  const { kit, lang, to } = useApp();
  const c = COPY[lang].home;
  const navigate = useNavigate();
  const { hash } = useLocation();
  const cycle = HERO_CYCLE.filter((id) => kit.D(id));
  const [i, setI] = useState(0);
  const stopped = useRef(false), paused = useRef(false), visible = useRef(true);
  const hostWrap = useRef<HTMLDivElement>(null);
  const hero = kit.D(cycle[i])!;
  const [swap, setSwap] = useState(false);

  useEffect(() => {
    stopped.current = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const el = hostWrap.current?.querySelector('#heroCar'); let io: IntersectionObserver | undefined;
    if (el && 'IntersectionObserver' in window) { io = new IntersectionObserver((es) => { visible.current = es[es.length - 1].isIntersecting; }); io.observe(el); }
    const t = setInterval(() => { if (!stopped.current && !paused.current && visible.current && !document.hidden) setI((n) => (n + 1) % cycle.length); }, 3400);
    return () => { clearInterval(t); io?.disconnect(); };
  }, [cycle.length]);
  // Arriving from the configurator's "Back to models" link (#versions): open at the version picker.
  useEffect(() => { if (hash === '#versions') requestAnimationFrame(() => document.getElementById('versions')?.scrollIntoView({ block: 'start' })); }, [hash]);
  useEffect(() => { if (i === 0) return; setSwap(false); const r = requestAnimationFrame(() => setSwap(true)); return () => cancelAnimationFrame(r); }, [i]);

  const cfg = kit.defaultCfg(hero);
  const fromPrice = Math.min(...kit.DESIGNS.map((x) => x.price));
  const goVersions = () => {
    const el = document.getElementById('versions'); if (!el) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  };
  return (
    <section className="view" data-view="home">
      {/* Hero: a soft beach backdrop that fades into the page; the car stands on the road, no box around it. */}
      <div className="hero hero-scene">
        <div className="hero-bg" aria-hidden="true" />
        <div className="hero-copy">
          {/* OFS/T lettering (black on light, white on dark); decorative, the page title is the headline.
              loading="lazy": only the version shown for the current theme is downloaded. */}
          <span className="hero-wordmark" aria-hidden="true">
            <img className="logo-l" src={BASE + 'assets/img/OFST-name-black.svg'} alt="" width="190" height="50" loading="lazy" />
            <img className="logo-d" src={BASE + 'assets/img/OFST-name-white.svg'} alt="" width="190" height="50" loading="lazy" />
          </span>
          <span className="eyebrow">{c.eyebrow}</span>
          <h1 className="display">
            <span className="ln" style={{ '--i': 0 } as any}>{c.h1[0]}</span><br />
            <span className="ln" style={{ '--i': 1 } as any}><em>{c.h1[1]}</em> {c.h1[2]}</span>
          </h1>
          <div className="hero-cta">
            <a className="btn btn-primary" href="#versions" onClick={(e) => { e.preventDefault(); goVersions(); }}>{c.open} <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14m-5-5 5 5 5-5" /></svg></a>
          </div>
        </div>
        <div className="hero-stage" ref={hostWrap}
          onMouseEnter={() => (paused.current = true)} onMouseLeave={() => (paused.current = false)} onFocus={() => (paused.current = true)} onBlur={() => (paused.current = false)}>
          <CarStage id="heroCar" cfg={cfg} style={{ cursor: 'pointer' }} onClick={() => navigate(to('configurator', 'design=' + hero.id))} />
          <div className="hero-caption">
            <div className={'hero-name' + (swap ? ' swap' : '')}><span className="eyebrow" id="heroCat">{hero.catName}</span><strong id="heroName">{hero.name}</strong></div>
            <div className="dots" id="heroDots" role="group" aria-label={c.showDesign}>
              {cycle.map((id, n) => <button key={id} type="button" aria-label={kit.D(id)!.name} aria-pressed={n === i} data-i={n} onClick={() => { stopped.current = true; setI(n); }} />)}
            </div>
          </div>
        </div>
      </div>

      {/* Version picker: each card opens the configurator with that Ami version already chosen. */}
      <section className="section versions" id="versions" aria-labelledby="versionsTitle" tabIndex={-1}>
        <div className="sec-head"><div><span className="eyebrow">{c.versionsEyebrow}</span><h2 className="display" id="versionsTitle">{c.versionsTitle}</h2></div></div>
        <div className="vgrid">
          {c.versions.map(([m, name, text]) => (
            <Link key={m} className="vcard" to={to('configurator', 'model=' + m)}>
              <span className="vcard-car"><Thumb cfg={{ ...kit.defaultCfg(kit.DESIGNS[0]), model: m as any }} /></span>
              <span className="vcard-body">
                <span className="vcard-name">{name}</span>
                <span className="vcard-text">{text}</span>
                <span className="vcard-foot"><span className="chip">{c.from(kit.money(fromPrice))}</span><span className="vcard-go">{c.configure}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M5 12h14m-5-5 5 5-5 5" /></svg></span></span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <div className="specs-strip">{c.specs.map(([k, v]) => <div key={k}><span className="eyebrow">{k}</span><b>{v}</b></div>)}</div>

      <div className="section">
        <div className="sec-head"><h2 className="display">{c.popular}</h2><Link className="btn btn-ghost" to={to('shop')}>{c.all(kit.DESIGNS.length)}</Link></div>
        <div className="grid-cards" id="featured">{FEATURED.map((id) => <DesignCard key={id} d={kit.D(id)!} />)}</div>
      </div>

      <div className="section" style={{ paddingTop: 0 }}>
        <div className="sec-head"><h2 className="display">{c.how}</h2></div>
        <div className="steps">{c.steps.map(([h, p], n) => <div className="step-card" key={h}><span className="n">{String(n + 1).padStart(2, '0')}</span><h3>{h}</h3><p>{p}</p></div>)}</div>
      </div>

      {/* What's in the kit: one flashcard per piece (door, window, front accent, rims). */}
      <section className="section kit-cards" style={{ paddingTop: 0 }} aria-labelledby="kitCardsTitle">
        <div className="sec-head"><div><span className="eyebrow">{c.kitEyebrow}</span><h2 className="display" id="kitCardsTitle">{c.kitTitle}</h2></div></div>
        <p className="muted kc-lead">{c.kitLead} <span className="kc-hint">{c.kitHint}</span></p>
        <ul className="kc-grid">
          {c.kitCards.map(([code, name, qty, tag, size, text]) => <KitCard key={code} code={code} name={name} qty={qty} tag={tag} size={size} text={text} sizeLabel={c.kitSize} qtyLabel={c.kitQty} />)}
        </ul>
      </section>

      <div className="section" style={{ paddingTop: 0 }}>
        <div className="fit">
          <div style={{ display: 'grid', gap: 14 }}>
            <span className="eyebrow">{c.fitEyebrow}</span>
            <h2 className="display" style={{ fontSize: 'clamp(1.5rem,3vw,2.2rem)' }}>{c.fitTitle}</h2>
            <p className="muted" style={{ margin: 0, maxWidth: '44ch' }}>{c.fitText}</p>
          </div>
          <ul className="mono" style={{ fontSize: '13.5px' }}>{c.fitList.map(([a, b]) => <li key={a}><span>{a}</span><span className="muted">{b}</span></li>)}</ul>
        </div>
      </div>

      <div className="section" style={{ paddingTop: 0 }}>
        <div className="canvas-band">
          <h2 className="display">{c.canvas}</h2>
          <Link className="btn btn-primary" to={to('configurator')}>{c.designYours}</Link>
        </div>
      </div>
    </section>
  );
}
