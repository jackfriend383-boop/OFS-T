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
          {/* OFS/T lettering (black on light, white on dark); decorative, the page title is the headline. */}
          <span className="hero-wordmark" aria-hidden="true">
            <img className="logo-l" src={BASE + 'assets/img/OFST-name-black.svg'} alt="" width="190" height="50" />
            <img className="logo-d" src={BASE + 'assets/img/OFST-name-white.svg'} alt="" width="190" height="50" />
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
