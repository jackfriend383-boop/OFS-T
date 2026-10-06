/* Home: live hero car that cycles through designs, featured designs, how it works.
   Auto-cycling (WCAG 2.2.2): off with prefers-reduced-motion, paused while hovered, focused, off-screen or in a hidden tab,
   and stopped for good once the visitor picks a design with the dots. */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useApp } from '../state';
import { COPY } from '../content';
import { FEATURED, HERO_CYCLE } from '../lib/kit';
import { CarStage } from '../components/Car';
import { DesignCard } from '../components/DesignCard';

export default function Home() {
  const { kit, lang, to } = useApp();
  const c = COPY[lang].home;
  const navigate = useNavigate();
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
  useEffect(() => { if (i === 0) return; setSwap(false); const r = requestAnimationFrame(() => setSwap(true)); return () => cancelAnimationFrame(r); }, [i]);

  const cfg = kit.defaultCfg(hero);
  return (
    <section className="view" data-view="home">
      <div className="hero">
        <div className="hero-copy">
          <span className="eyebrow">{c.eyebrow}</span>
          <h1 className="display">
            <span className="ln" style={{ '--i': 0 } as any}>{c.h1[0]}</span><br />
            <span className="ln" style={{ '--i': 1 } as any}><em>{c.h1[1]}</em> {c.h1[2]}</span>
          </h1>
          <p className="lead">{c.lead}</p>
          <div className="hero-cta">
            <Link className="btn btn-primary" to={to('configurator')}>{c.open} <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14m-5-5 5 5-5 5" /></svg></Link>
            <Link className="btn btn-ghost" to={to('shop')}>{c.browse}</Link>
          </div>
        </div>
        <div className="hero-stage" ref={hostWrap} style={{ '--tint': kit.COLORS[cfg.c1]?.hex } as any}
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
