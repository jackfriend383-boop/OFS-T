/* Configurator: live stage (the arrows turn the car between camera angles; day or night scene following the site theme), design picker strip,
   Ami version/car colour/vinyl colour/pieces/finish/extras options, summary and the mobile bar.
   Reads an optional starting config from the query string (?design=&c1=&c2=&finish=&kit=&number=&model=&trim=&pieces=), validated against the data. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useApp } from '../state';
import { COPY } from '../content';
import { CATS, TRIMS, PIECES, PIECE_PRICE, includedPieces, piecesPrice, type Cfg, type Piece } from '../lib/kit';
import { CarStage, Thumb, type StageApi } from '../components/Car';
import { viewIcon, anglesOf, type Angle } from '../lib/car';
import { FilterTabs } from '../components/DesignCard';
import { useFilterFeedback } from '../lib/filter';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Visual price tween; the final value is announced once through #sumLive, not every frame. */
function Price({ value, id }: { value: number; id: string }) {
  const { kit } = useApp();
  const ref = useRef<HTMLElement>(null);
  const from = useRef(value);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const a = from.current; from.current = value;
    if (reduced() || a === value) { el.textContent = kit.money(value); return; }
    const t0 = performance.now(); let raf = 0;
    const f = (n: number) => { const k = Math.min(1, (n - t0) / 450); el.textContent = kit.money(Math.round(a + (value - a) * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(f); };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [value, kit]);
  return <strong id={id} ref={ref}>{kit.money(value)}</strong>;
}

/* Colour swatches: one radio group per slot, shown as two rows (classic colours, then metallic specials).
   Roving tabindex across both rows: arrow keys move and select, Home/End jump. */
function Swatches({ slot, labelId, cfg, onPick, groups }: { slot: 'c1' | 'c2'; labelId: string; cfg: Cfg; onPick: (k: string) => void; groups: [string, string] }) {
  const { kit } = useApp();
  const row = useRef<HTMLDivElement>(null);
  const keys = Object.keys(kit.COLORS);
  const sets: [string, string[]][] = [[groups[0], keys.filter((k) => !kit.COLORS[k].metal)], [groups[1], keys.filter((k) => kit.COLORS[k].metal)]];
  const onKey = (e: React.KeyboardEvent) => {
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
    if (step === undefined && e.key !== 'Home' && e.key !== 'End') return;
    const bs = [...row.current!.querySelectorAll<HTMLElement>('.sw')], i = bs.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault(); e.stopPropagation();
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : (i + step + bs.length) % bs.length;
    onPick(bs[j].dataset.k!); bs[j].focus();
  };
  return (
    <div className="sw-groups" id={slot + 'Row'} ref={row} role="radiogroup" aria-labelledby={labelId} onKeyDown={onKey}>
      {sets.map(([title, ks]) => ks.length > 0 && (
        <div key={title} className="sw-group">
          <span className="sw-group-t" aria-hidden="true">{title}</span>
          <div className="sw-row">
            {ks.map((k) => {
              const sel = cfg[slot] === k;
              return <button key={k} type="button" className={'sw' + (kit.COLORS[k].metal ? ' metal' : '')} style={{ '--c': kit.COLORS[k].hex } as any} data-k={k} role="radio" aria-checked={sel} tabIndex={sel ? 0 : -1} title={kit.COLORS[k].name} aria-label={kit.COLORS[k].name} onClick={() => onPick(k)} />;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* Car colour (factory trim of the chosen Ami version): one radio per trim, a round two-tone swatch plus its name.
   Arrow keys move and select, like the vinyl colour swatches. */
const TRIM_SW: Record<string, [string, string]> = { yellow: ['#111214', '#E4F21B'], purple: ['#111214', '#B79BEA'], brown: ['#8C8379', '#8C8379'], browncolor: ['#8C8379', '#5BE07A'], base: ['#8C8379', '#8C8379'] };
function Trims({ labelId, value, items, names, onPick }: { labelId: string; value: string; items: string[]; names: Record<string, string>; onPick: (k: string) => void }) {
  const row = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
    if (step === undefined) return;
    const bs = [...row.current!.querySelectorAll<HTMLElement>('.trim')], i = bs.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault(); e.stopPropagation();
    const j = (i + step + bs.length) % bs.length;
    onPick(bs[j].dataset.k!); bs[j].focus();
  };
  return (
    <div className="trims" id="trimRow" ref={row} role="radiogroup" aria-labelledby={labelId} onKeyDown={onKey}>
      {items.map((k) => {
        const sel = value === k, [a, b] = TRIM_SW[k] || TRIM_SW.base;
        return <button key={k} type="button" className="trim" data-k={k} role="radio" aria-checked={sel} tabIndex={sel ? 0 : -1} onClick={() => onPick(k)}>
          <span className="trim-sw" style={{ '--c': a, '--c2': b } as any} aria-hidden="true" /><span className="trim-n">{names[k] || k}</span>
        </button>;
      })}
    </div>
  );
}

function Seg({ id, label, labelledBy, value, items, onPick }: { id: string; label?: string; labelledBy?: string; value: string; items: [string, string][]; onPick: (v: string) => void }) {
  const i = Math.max(0, items.findIndex(([v]) => v === value));
  return (
    <div className="seg" id={id} data-i={i} role="group" aria-label={label} aria-labelledby={labelledBy}>
      <span className="knob" aria-hidden="true" />
      {items.map(([v, t]) => <button key={v} type="button" data-v={v} aria-pressed={v === value} onClick={() => onPick(v)}>{t}</button>)}
    </div>
  );
}

/* Small outline of each piece, after the shapes of the sticker templates (door strip, window, front accent, rim ring). */
const PIECE_ICON: Record<string, string> = {
  door: 'M3 17h30l5-6h7v8H3z',
  window: 'M12 5h24a5 5 0 0 1 5 5v4a5 5 0 0 1-5 5H12a5 5 0 0 1-5-5v-4a5 5 0 0 1 5-5z',
  windowPop: 'M7 20a17 17 0 0 1 34 0h-7a10 10 0 0 0-20 0z',
  accent: 'M3 10h33l8 5v4h-5v-2l-4-3H3z',
  rims: 'M24 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  full: 'M3 20h22l3-4h5v4M8 6h14a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3zM33 6h12M33 11h12',
};
const pieceIcon = (k: string) => <svg viewBox="0 0 48 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" focusable="false"><path d={PIECE_ICON[k]} /></svg>;

/* Site theme: dark (header toggle sets <html data-ofst="dark">) shows the night city scene with the car lights on. */
const isDarkSite = () => typeof document !== 'undefined' && document.documentElement.dataset.ofst === 'dark';

export default function Configurator() {
  const { kit, T, lang, to, addToCart, announce, cfgProvider, onPickDesign, onEditConfig } = useApp();
  const c = COPY[lang].cfg, money = kit.money, DESIGNS = kit.DESIGNS;
  const { search } = useLocation();
  const [cfg, setCfg] = useState<Cfg>(() => kit.defaultCfg(DESIGNS[0]));
  const cfgRef = useRef(cfg); cfgRef.current = cfg;
  const [ready, setReady] = useState(false);
  const [cat, setCat] = useState('All');
  const [numErr, setNumErr] = useState('');
  const [added, setAdded] = useState(false);
  const [sumLive, setSumLive] = useState('');
  const [view, setView] = useState('full');
  // Camera angle of the preview photo (front, front ¾, side, rear); the arrows, ← → and swipes turn the car.
  const [angle, setAngle] = useState<Angle>('side');
  const angles = anglesOf(cfg.model);
  const trims = TRIMS[cfg.model];
  // Preview background: grey studio or the beach. Remembered for this browser tab only.
  const [scene, setScene] = useState<'studio' | 'beach'>('studio');
  useEffect(() => { try { if (sessionStorage.getItem('ofst-scene') === 'beach') setScene('beach'); } catch { /* private mode */ } }, []);
  // Night preview follows the site theme (light = day scenes above, dark = night city).
  const [night, setNightState] = useState(false);
  useEffect(() => {
    const sync = () => setNightState(isDarkSite());
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ofst'] });
    return () => mo.disconnect();
  }, []);
  const toggleScene = () => setScene((v) => { const n = v === 'beach' ? 'studio' : 'beach'; try { sessionStorage.setItem('ofst-scene', n); } catch { /* private mode */ } return n; });
  const api = useRef<StageApi | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const numInput = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  const d = kit.D(cfg.design)!;
  const visible = DESIGNS.filter((x) => cat === 'All' || x.cat === cat);
  useFilterFeedback(cat, '#strip .pcard', visible.length);

  /* Badge text may be empty while the visitor is typing; sanitizeCfg would switch the badge off and reset it to "AMI". */
  const update = useCallback((patch: Partial<Cfg>) => {
    const merged = { ...cfgRef.current, ...patch }, next = kit.sanitizeCfg(merged);
    if (!next) return;
    next.numberOn = !!merged.numberOn && next.model !== 'pop'; // the custom badge is only offered on the Ami 2025
    if (typeof merged.number === 'string') next.number = kit.cleanNumber(merged.number);
    if (!next.numberOn && !next.number) next.number = 'AMI';
    cfgRef.current = next; setCfg(next);
  }, [kit]);

  const scrollToCard = useCallback((id: string, smooth: boolean) => {
    const s = strip.current, card = s?.querySelector<HTMLElement>(`.pcard[data-id="${id}"]`);
    // Only the phone layout scrolls sideways; on wide screens the designs are a grid and nothing needs to move.
    if (s && card && !card.classList.contains('out') && s.scrollWidth > s.clientWidth + 4) s.scrollTo({ left: card.offsetLeft - s.offsetLeft - 24, behavior: reduced() || !smooth ? 'auto' : 'smooth' });
  }, []);
  const pickDesign = useCallback((id: string, resetColors: boolean, smooth = true) => {
    const x = kit.D(id); if (!x) return;
    update(resetColors ? { design: id, c1: x.c1, c2: x.c2 } : { design: id });
    scrollToCard(id, smooth);
  }, [kit, update, scrollToCard]);

  // Starting config from the query string (after hydration, so the server and first client render agree).
  useEffect(() => {
    const q = kit.cfgFromQuery(search);
    if (q) { cfgRef.current = q; setCfg(q); }
    setReady(true);
    const sel = q || cfgRef.current;
    if (sel.design !== DESIGNS[0].id) requestAnimationFrame(() => scrollToCard(sel.design, false));
    const t = setTimeout(() => { started.current = true; }, 0);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Search results, design cards and cart "edit" act in place on this page instead of navigating;
     the language switch carries the kit being designed to the other language. */
  useEffect(() => {
    onPickDesign.current = (id) => pickDesign(id, true);
    onEditConfig.current = (x) => { const v = kit.sanitizeCfg(x); if (v) update(v); };
    cfgProvider.current = () => cfgRef.current;
    return () => { onPickDesign.current = null; onEditConfig.current = null; cfgProvider.current = null; };
  }, [kit, pickDesign, update, onPickDesign, onEditConfig, cfgProvider]);

  /* Turn the car to the previous/next camera angle (wraps around); the camera goes back to the full view of that angle. */
  const rotate = useCallback((dir: number) => {
    const list = anglesOf(cfgRef.current.model); if (list.length < 2) return;
    const cur = api.current?.currentAngle() ?? 'side';
    const next = list[((list.indexOf(cur) < 0 ? 0 : list.indexOf(cur)) + dir + list.length) % list.length];
    api.current?.angle(next); setAngle(next); setView('full');
  }, []);
  // A version with fewer photos (Ami Pop) falls back to its first angle.
  useEffect(() => {
    if (!angles.includes(angle)) { api.current?.angle(angles[0]); setAngle(angles[0]); }
  }, [cfg.model]); // eslint-disable-line react-hooks/exhaustive-deps
  // Car lights on at night; re-applied when the stage mounts or the car/angle changes.
  useEffect(() => { api.current?.setNight?.(night); }, [night, ready, cfg.model, angle]);
  /* ← / → turn the car when nothing interactive has focus (or focus is on the stage), never with modifier keys (Alt+← is "back"). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
      const a = document.activeElement, st = document.getElementById('stage');
      if (!(a === document.body || a === document.documentElement || a === document.getElementById('main') || (st && st.contains(a) && !(a as HTMLElement).closest('#views')))) return;
      if (document.getElementById('drawer')?.classList.contains('on') || document.getElementById('search')?.classList.contains('on')) return;
      rotate(e.key === 'ArrowLeft' ? -1 : 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [rotate]);

  // Swipe the car left/right on touch screens to turn it.
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const tones = d.art === 'flame';
  const pop = cfg.model === 'pop';
  const ps = cfg.pieces, isFull = ps.includes('full');
  /* Price lines: the full kit, or each chosen pair; rims and the badge are added on top. */
  const lines: [string, string][] = [];
  if (isFull) lines.push([c.kitFull(d.name), money(d.price)]);
  else (['door', 'window', 'accent'] as const).forEach((p) => { if (ps.includes(p)) lines.push([T('pc_' + p), money(PIECE_PRICE[p])]); });
  if (ps.includes('rims')) lines.push([T('pc_rims'), (lines.length ? '+' : '') + money(PIECE_PRICE.rims)]);
  if (cfg.numberOn && cfg.number) lines.push([T('badgeText', { text: cfg.number }), '+' + money(kit.EXTRA.badge)]);
  /* "What's included": every piece in the box with its quantity, plus the badge and the fitting guide. */
  const included: string[] = includedPieces(cfg).map((p) => `${p === 'rims' ? 4 : 2} × ${c.inc[p]}`);
  if (cfg.numberOn && cfg.number) included.push(`1 × ${c.inc.badge}`);
  included.push(`1 × ${c.inc.guide}`);
  /* Pieces: full kit is exclusive with door/window/accent; rims combine with anything. sanitizeCfg then applies the shared rules
     (e.g. choosing every piece of the full kit becomes the full kit). */
  const togglePiece = (p: Piece) => {
    const cur = cfgRef.current.pieces, rims: Piece[] = cur.includes('rims') ? ['rims'] : [];
    let next: Piece[];
    if (p === 'rims') next = rims.length ? cur.filter((x) => x !== 'rims') : [...cur, 'rims'];
    else if (p === 'full') next = ['full', ...rims];
    else if (cur.includes('full')) next = [p, ...rims];
    else next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p];
    update({ pieces: next });
  };
  const pieceItems = PIECES.filter((p) => p !== 'accent' || pop);
  const prevLines = useRef<string[]>([]);
  const fresh = lines.map(([a, b]) => !prevLines.current.includes(a + b));
  useEffect(() => { prevLines.current = lines.map(([a, b]) => a + b); });
  const pers = kit.isPersonalised(cfg), total = kit.priceOf(cfg);

  // Final value announced once, after the changes settle.
  useEffect(() => {
    if (!started.current) return;
    const msg = T('cfgSay', { name: d.name, model: kit.modelName(cfg.model), colours: kit.colourLabel(cfg), finish: T(cfg.finish === 'gloss' ? 'glossLc' : 'matteLc'), sides: kit.piecesLabel(cfg), total: money(total) }) + (pers ? T('cfgSayPers') : '');
    const t = setTimeout(() => setSumLive(msg), 600);
    return () => clearTimeout(t);
  }, [cfg, kit]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Swap" flash on the stage tag when the design changes.
  const tagRef = useRef<HTMLDivElement>(null);
  const prevDesign = useRef(cfg.design);
  useEffect(() => {
    if (prevDesign.current !== cfg.design && !reduced()) { const t = tagRef.current; if (t) { t.classList.remove('swap'); void t.offsetWidth; t.classList.add('swap'); } }
    prevDesign.current = cfg.design;
  }, [cfg.design]);

  const addCurrent = () => {
    if (cfg.numberOn && !cfg.number) { setNumErr(T('numErr')); numInput.current?.focus(); return; }
    addToCart(cfg);
    setAdded(true); clearTimeout((addCurrent as any).t);
    (addCurrent as any).t = setTimeout(() => setAdded(false), 1600);
  };
  const addLabel = added ? T('added') : T('addToCart');
  const colourName = (k: string) => kit.COLORS[k].name;

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  const colourText = d.fixed ? T('originalColours') : `${colourName(cfg.c1)} / ${colourName(cfg.c2)}`;
  /* "Your selection" rows: label, value, price, and the options card that "Change" scrolls back to. */
  const rows: [string, string, string, string][] = [
    [c.design, d.name, '', 'optDesignCard'],
    [c.version, kit.modelName(cfg.model), '', 'optModelCard'],
    ...(trims.length > 1 ? [[c.carColour, c.trims[cfg.trim] || cfg.trim, '', 'optModelCard'] as [string, string, string, string]] : []),
    [c.colours, colourText, '', 'optColourCard'],
    [c.finish, cfg.finish === 'gloss' ? c.gloss : c.matte, '', 'optFinishCard'],
    [c.pieces, kit.piecesLabel(cfg), money(piecesPrice(ps, d.price)), 'optPiecesCard'],
    [c.extras, cfg.numberOn && cfg.number ? `${c.badgeName} “${cfg.number}”` : c.none, cfg.numberOn && cfg.number ? '+' + money(kit.EXTRA.badge) : '', 'optExtrasCard'],
  ];
  const toggleFull = () => {
    const el = document.getElementById('stageWrap') as any; if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.(); else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  };
  // Dragging the zoomed picture (mouse or touch); a quick swipe on the full view turns the car on touch screens.
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const icon = (d: string) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={d} /></svg>;

  return (
    <section className="view cfgv" data-view="configurator">
      <div className="cbar">
        <div className="cbar-l">
          <Link to={to('home') + '#versions'} className="cbar-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M19 12H5m5-5-5 5 5 5" /></svg>{c.back}</Link>
        </div>
        <div className="cbar-r">
          <div className="cbar-price"><Price id="barTotal" value={total} /><small>{c.total}</small></div>
          <button type="button" className="btn btn-2" onClick={() => jump('summary')}>{c.summaryBtn}</button>
          <button type="button" className={'btn btn-primary' + (added ? ' done' : '')} id="barAdd" onClick={addCurrent}>{addLabel}</button>
        </div>
      </div>

      <div className="cfg">
        <div className="cfg-media">
          <div className="stage-wrap" id="stageWrap">
          <section className={'stage scene-' + (night ? 'night' : scene)} id="stage" aria-label={c.preview}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              if (api.current?.zoomed()) { drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); (e.currentTarget as HTMLElement).classList.add('grabbing'); return; }
              if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => { const g = drag.current; if (!g || g.id !== e.pointerId) return; api.current?.pan(e.clientX - g.x, e.clientY - g.y); g.x = e.clientX; g.y = e.clientY; }}
            onPointerCancel={(e) => { swipe.current = null; drag.current = null; (e.currentTarget as HTMLElement).classList.remove('grabbing'); }}
            onPointerUp={(e) => {
              if (drag.current) { drag.current = null; (e.currentTarget as HTMLElement).classList.remove('grabbing'); return; }
              const s = swipe.current; if (!s) return; swipe.current = null; const dx = e.clientX - s.x, dy = e.clientY - s.y; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) rotate(dx < 0 ? 1 : -1);
            }}>
            <div className="stage-tag" id="stageTag" ref={tagRef}><span className="eyebrow" id="stCat">{d.catName || d.cat}</span><strong id="stName">{d.name}</strong><span id="stTag">{d.tag}</span></div>
            {ready
              ? <CarStage id="cfgCar" cfg={cfg} apiRef={api} />
              : <div id="cfgCar"><svg className="car-svg" viewBox="530 250 1080 646" aria-hidden="true" focusable="false" /></div>}
            {angles.length > 1 && <>
              <button type="button" className="stage-arrow prev" id="prevD" aria-label={c.prev} aria-controls="cfgCar" onClick={() => rotate(-1)}>{icon('m15 6-6 6 6 6')}</button>
              <button type="button" className="stage-arrow next" id="nextD" aria-label={c.next} aria-controls="cfgCar" onClick={() => rotate(1)}>{icon('m9 6 6 6-6 6')}</button>
              <div className="stage-angle" id="stageAngle" role="status" aria-live="polite">{c.angles[angle]}</div>
            </>}
            <div className="stage-ctrl" role="group" aria-label={c.camera}>
              <button type="button" id="btnReplay" title={c.replay} aria-label={c.replay} onClick={() => api.current?.replay()}>{icon('M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4')}<span>{c.replay}</span></button>
              <span className="ctrl-sep" aria-hidden="true" />
              <button type="button" id="btnZoomOut" title={c.zoomOut} aria-label={c.zoomOut} onClick={() => api.current?.zoom(1.35)}>{icon('M5 12h14')}</button>
              <button type="button" id="btnZoomIn" title={c.zoomIn} aria-label={c.zoomIn} onClick={() => api.current?.zoom(1 / 1.35)}>{icon('M12 5v14M5 12h14')}</button>
              <span className="ctrl-sep" aria-hidden="true" />
              <button type="button" id="btnFull" title={c.fullscreen} aria-label={c.fullscreen} onClick={toggleFull}>{icon('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5')}</button>
            </div>
            {angles.length > 1 && <div className="stage-hint" aria-hidden="true">{c.hint}</div>}
          </section>
          </div>
          <div className="views" id="views" role="group" aria-label={c.camera}>
            {c.views.map(([v, t]) => <button key={v} type="button" data-v={v} aria-pressed={view === v} onClick={() => { setView(v); api.current?.view(v); setAngle(api.current?.currentAngle() ?? angle); }}><span className={'vi vi-' + v} dangerouslySetInnerHTML={{ __html: viewIcon(cfg.model, v as 'full' | 'door' | 'window') }} />{t}</button>)}
            {/* Studio/beach only in the light theme; the dark theme always shows the night city. */}
            {!night && <>
            <span className="views-sep" aria-hidden="true" />
            <button type="button" className="scene-btn" id="btnScene" aria-pressed={scene === 'beach'} title={c.scenery} onClick={toggleScene}>
              <span className="vi vi-scene" aria-hidden="true"><svg viewBox="0 0 64 40" focusable="false"><rect x="3" y="3" width="58" height="34" rx="3" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M8 32 22 18l8 8 6-5 20 11z" fill="currentColor" /><circle cx="45" cy="13" r="4" fill="currentColor" /></svg></span>
              {c.scenery}: {scene === 'beach' ? c.beach : c.studio}
            </button>
            </>}
          </div>
        </div>

        <div className="cfg-panel" aria-label={c.options} role="region">
          <header className="cfg-title">
            <h1 className="eyebrow">{c.h1[0]} {c.h1[1]}</h1>
            <p className="cfg-name"><span id="optDesign">{d.name}</span><span className="chip">{d.catName || d.cat}</span></p>
            <p className="muted cfg-lead">{c.lead}</p>
          </header>

          <section className="ocard" id="optDesignCard" aria-labelledby="pickerTitle">
            <div className="ocard-head"><h2 id="pickerTitle">{c.choose}</h2><span className="ocard-price">{money(d.price)}</span></div>
            <div className="picker" id="picker">
              <FilterTabs id="cfgTabs" cats={CATS} value={cat} onPick={setCat} label={COPY[lang].shop.filter} />
              <div className="strip" id="strip" role="group" aria-label={c.designsGroup} ref={strip}>
                {DESIGNS.map((x) => (
                  <button key={x.id} type="button" className={'pcard' + (cat !== 'All' && x.cat !== cat ? ' out' : '')} data-id={x.id} data-cat={x.cat} aria-pressed={x.id === cfg.design} onClick={() => pickDesign(x.id, true)}>
                    <Thumb cfg={kit.defaultCfg(x)} /><b>{x.name}</b><small><span>{x.tag}</span><span className="price">{money(x.price)}</span></small>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="ocard" id="optModelCard" aria-labelledby="optModelLbl">
            <div className="ocard-head"><h2 id="optModelLbl">{c.version}</h2><span className="ocard-val">{kit.modelName(cfg.model)}</span></div>
            <Seg id="segModel" labelledBy="optModelLbl" value={cfg.model} items={[['qs', 'Ami 2025'], ['pop', 'Pop']]} onPick={(v) => update({ model: v as Cfg['model'] })} />
            {trims.length > 1 && <>
              <div className="sub-label"><span id="trimLabel">{c.carColour}</span><span id="trimName">{c.trims[cfg.trim] || cfg.trim}</span></div>
              <Trims labelId="trimLabel" value={cfg.trim} items={trims} names={c.trims} onPick={(k) => update({ trim: k })} />
            </>}
          </section>

          <section className="ocard" id="optColourCard" aria-labelledby="optColourLbl">
            <div className="ocard-head"><h2 id="optColourLbl">{c.colours}</h2></div>
            {/* Two clearly separated palettes: Colour 1 (heading, chosen colour, swatches), a divider, then Colour 2. */}
            <div className="opt-body pals" id="swWrap" hidden={!!d.fixed}>
              {(['c1', 'c2'] as const).map((slot, i) => (
                <div className="pal" key={slot}>
                  <div className="pal-head">
                    <h3 id={slot + 'Label'}>{i ? c.colour2 : c.colour1}<small>{T(tones ? (i ? 'darkTone' : 'lightTone') : (i ? 'accent' : 'primary'))}</small></h3>
                    <span className="pal-name" id={slot + 'Name'}><i style={{ '--c': kit.COLORS[cfg[slot]].hex } as any} aria-hidden="true" />{colourName(cfg[slot])}</span>
                  </div>
                  <Swatches slot={slot} labelId={slot + 'Label'} cfg={cfg} groups={[c.classics, c.metallics]} onPick={(k) => update(slot === 'c1' ? { c1: k } : { c2: k })} />
                </div>
              ))}
            </div>
            <span className="opt-val" id="fixedNote" hidden={!d.fixed}>{c.fixed}</span>
          </section>

          {/* Pieces: full kit (default) or individual pairs; rims as an add-on. */}
          <section className="ocard" id="optPiecesCard" aria-labelledby="optPiecesLbl">
            <div className="ocard-head"><h2 id="optPiecesLbl">{c.pieces}</h2><span className="ocard-price">{money(piecesPrice(ps, d.price))}</span></div>
            <div className="pcs" role="group" aria-labelledby="optPiecesLbl">
              {pieceItems.map((p) => {
                const on = ps.includes(p);
                const note = p === 'full' ? c.fullNote(pop) : p === 'rims' ? c.set4 : c.pair;
                const price = p === 'full' ? d.price : PIECE_PRICE[p];
                return <button key={p} type="button" className={'pc' + (p === 'rims' ? ' pc-add' : '')} data-p={p} role="checkbox" aria-checked={on} onClick={() => togglePiece(p)}>
                  <span className="pc-ic">{pieceIcon(p === 'window' && pop ? 'windowPop' : p)}</span>
                  <span className="pc-t"><b>{c.pc[p]}</b><small>{note}</small></span>
                  <span className="pc-p">{p === 'rims' ? '+' : ''}{money(price)}</span>
                  <span className="pc-ck" aria-hidden="true" />
                </button>;
              })}
            </div>
            <p className="opt-val pcs-note">{c.piecesNote} {c.piecesAuto}</p>
          </section>

          <section className="ocard" id="optFinishCard" aria-labelledby="optFinishLbl">
            <div className="ocard-head"><h2 id="optFinishLbl">{c.finishKit}</h2></div>
            <Seg id="segFinish" label={c.finish} value={cfg.finish} items={[['matte', c.matte], ['gloss', c.gloss]]} onPick={(v) => update({ finish: v as Cfg['finish'] })} />
          </section>

          {/* Extras: for now only the custom badge (Ami 2025 only: the Pop door has no badge plate). */}
          <section className="ocard" id="optExtrasCard" aria-labelledby="optExtrasLbl">
            <div className="ocard-head"><h2 id="optExtrasLbl">{c.extras}</h2></div>
            <div className={'xtra' + (pop ? ' off' : '')} id="optBadgeCard">
              <div className="opt-title"><span className="xtra-n" id="numLbl">{c.badgeName}</span>
                <span className="xtra-r"><span className="pc-p">+{money(kit.EXTRA.badge)}</span>
                <button type="button" className="toggle" id="numToggle" role="switch" aria-checked={cfg.numberOn} aria-labelledby="numLbl" disabled={pop} aria-describedby={pop ? 'numPop' : undefined}
                  onClick={() => { update({ numberOn: !cfg.numberOn }); setNumErr(''); if (!cfg.numberOn) requestAnimationFrame(() => numInput.current?.focus()); }} /></span></div>
              {pop
                ? <p className="opt-val" id="numPop">{c.popOnly}</p>
                : <>
                  <label className="opt-val" htmlFor="numInput" id="numHint">{c.badgeHint(money(kit.EXTRA.badge))}</label>
                  <input className="field" id="numInput" ref={numInput} maxLength={8} placeholder={c.badgePh} value={cfg.number} disabled={!cfg.numberOn} autoComplete="off" spellCheck={false} autoCapitalize="characters"
                    aria-labelledby="numLbl numHint" aria-invalid={numErr && cfg.numberOn ? true : undefined} aria-describedby={numErr && cfg.numberOn ? 'numErr' : undefined}
                    onChange={(e) => { const v = kit.cleanNumber(e.target.value); if (v) setNumErr(''); update({ number: v }); }} />
                  <p className="err" id="numErr" role="alert" hidden={!numErr || !cfg.numberOn}>{numErr}</p>
                </>}
            </div>
          </section>
        </div>
      </div>

      <section className="csum" id="summary" aria-labelledby="sumTitle">
        <div className="csum-media">
          <div className="csum-stage">
            <p className="csum-kicker">{c.kicker[0]} {c.kicker[1]}</p>
            <Thumb cfg={cfg} eager className="csum-car" />
          </div>
          <div className="selcard">
            <h3>{c.selection}</h3>
            <ul className="sel">
              {rows.map(([k, v, p, card]) => (
                <li key={k}><span className="sel-k">{k}</span><span className="sel-v">{v}</span><span className="sel-p price">{p}</span>
                  <button type="button" className="sel-c" aria-label={c.changeAria(k)} onClick={() => jump(card)}>{c.change}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="m9 6 6 6-6 6" /></svg></button></li>
              ))}
            </ul>
          </div>
        </div>
        <aside className="summary">
          <h2 id="sumTitle">{c.summaryTitle}</h2>
          <div><h3 id="sumName">{d.name}</h3><span className="muted" id="sumSub">{`${kit.modelName(cfg.model)} · ${kit.colourLabel(cfg)} · ${T(cfg.finish === 'gloss' ? 'gloss' : 'matte')}`}</span></div>
          <div className="total"><span className="muted">{c.total}</span><Price id="sumTotal" value={total} /></div>
          <ul className="lines" id="sumLines">{lines.map(([a, b], n) => <li key={a + b} className={fresh[n] && started.current ? 'in' : ''}><span>{a}</span><span>{b}</span></li>)}</ul>
          <div className="incl"><h4 id="inclTitle">{c.included}</h4><ul aria-labelledby="inclTitle">{included.map((x) => <li key={x}>{x}</li>)}</ul></div>
          <button type="button" className={'btn btn-primary' + (added ? ' done' : '')} id="addCart" onClick={addCurrent}>{addLabel}</button>
          <button type="button" className="btn btn-2" onClick={() => jump('optDesignCard')}>{c.change}</button>
          <p className="pers-note" id="persNote" hidden={!pers}>{c.persBefore}<Link to={to('refunds') + '#personalised'}>{c.persLink}</Link>{c.persAfter}</p>
          <div className="ship"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M2 6h12v10H2zM14 9h4l3 3.5V16h-7" /><circle cx="6" cy="17.5" r="1.7" /><circle cx="17" cy="17.5" r="1.7" /></svg><span>{c.ship[0]}<br />{c.ship[1]}</span></div>
          <p className="sr" id="sumLive" role="status" aria-live="polite">{sumLive}</p>
          <dl className="specs">{c.specs.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </aside>
      </section>

      <section className="brochure" aria-labelledby="broTitle">
        <div className="bro-head">
          <span className="eyebrow">{c.brochure.eyebrow}</span>
          <h2 id="broTitle" className="display">{c.brochure.title}</h2>
          <p className="muted">{c.brochure.lead}</p>
        </div>
        <div className="bro-grid">
          <div className="bro-hero"><Thumb cfg={{ ...cfg, numberOn: false }} className="bro-car" /></div>
          {c.brochure.cards.map(([t, x], i) => <div className="bro-card" key={t}><span className="bro-n">{String(i + 1).padStart(2, '0')}</span><h3>{t}</h3><p>{x}</p></div>)}
        </div>
      </section>

      <div className="mbar"><div><span className="eyebrow" id="mName">{d.name}</span><br /><Price id="mTotal" value={total} /></div><button type="button" className={'btn btn-primary' + (added ? ' done' : '')} id="mAdd" onClick={addCurrent}>{addLabel}</button></div>
    </section>
  );
}
