import { memo, useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import { Stage, THUMB_PLACEHOLDER, stagePoster, thumbSVG, type Angle } from '../lib/car';
import type { Cfg } from '../lib/kit';

/* A car picture with the sticker design on it. Drawn when it comes near the viewport (or near the visible part of the horizontal
   design strip), instead of building every SVG up front. The server renders a same-sized placeholder, so nothing shifts.
   While it is far from view, a change of design or colour is not redrawn until it comes back (the summary and brochure cars
   of the configurator no longer rebuild on every option click). */
export const Thumb = memo(function Thumb({ cfg, decorative = true, eager = false, className = 'mini' }: { cfg: Cfg; decorative?: boolean; eager?: boolean; className?: string }) {
  const { kit } = useApp();
  const ref = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(eager);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (!('IntersectionObserver' in window)) { setNear(true); return; }
    const io = new IntersectionObserver((es) => setNear(es[es.length - 1].isIntersecting), { root: el.closest('.strip'), rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const key = kit.keyOf(cfg) + kit.lang + decorative + cfg.trim; // the car colour is not part of the kit key, but changes the picture
  // Last drawn picture and its key: redrawn only when near the screen and something changed.
  const drawn = useRef<{ key: string; html: string }>({ key: '', html: THUMB_PLACEHOLDER });
  if (near && drawn.current.key !== key) drawn.current = { key, html: thumbSVG(kit, cfg, decorative) };
  return <span ref={ref} className={className || undefined} style={{ display: 'block' }} dangerouslySetInnerHTML={{ __html: drawn.current.html }} />;
});

/* The live car (hero + configurator). The Stage draws its own SVG; React only owns the host element.
   setNight(on): night scene (car lights on), used by the configurator in the dark theme. */
export interface StageApi { view: (name: string) => void; zoom: (f: number) => void; pan: (dx: number, dy: number) => void; zoomed: () => boolean; angle: (name: Angle) => void; currentAngle: () => Angle; setNight: (on: boolean) => void }
/* Drive-in on the first mount (desktop with a mouse, motion allowed): the car drives in from the right (its front faces left) and
   slows to a gentle stop with one decelerating curve, no bounce. The wheels are part of the photo, so a copy of each rim is drawn
   over it (Stage.wheelSpin) and turned with the distance travelled: it spins fast at the start and stops with the car, after a whole
   number of turns, so the last frame is the plain photo (the overlay is then removed). Plays once per page visit (marked done when
   it finishes, so a React dev double mount still plays it). Client only (runs in an effect). */
let ROLLED = false;
const ROLL_MS = 2000;
function rollInCar(el: HTMLElement, st: () => Stage | null): (() => void) | null {
  if (ROLLED || typeof matchMedia !== 'function' || typeof el.animate !== 'function') return null;
  if (!matchMedia('(hover: hover) and (pointer: fine) and (min-width: 900px)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const s = st(); if (!s) return null;
  const x0 = Math.ceil(window.innerWidth - el.getBoundingClientRect().left + 40); // starts just outside the right edge of the window
  const { tyreR, unitsPerPx } = s.rollInfo();
  const turns = Math.max(1, Math.round((x0 * unitsPerPx) / (2 * Math.PI * tyreR))); // whole turns for that distance
  const html = document.documentElement, ox = html.style.overflowX;
  html.style.overflowX = 'clip'; // the car starts beyond the right edge: no scrollbar while it drives in
  const anim = el.animate(
    [{ transform: `translate3d(${x0}px, 0, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
    { duration: ROLL_MS, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' },
  );
  let raf = 0, over = false;
  const spin = () => {
    if (over) return;
    const p = anim.effect?.getComputedTiming().progress; // distance travelled so far, 0..1 (after the easing)
    stage()?.wheelSpin(-360 * turns * (p == null ? 1 : p)); // anticlockwise: the top of the wheel moves left, with the car
    raf = requestAnimationFrame(spin);
  };
  const stage = st;
  const end = (done: boolean) => {
    over = true; cancelAnimationFrame(raf); html.style.overflowX = ox;
    stage()?.wheelSpin(null);
    if (done) ROLLED = true;
  };
  spin();
  anim.onfinish = () => end(true);
  anim.oncancel = () => end(false);
  return () => { anim.cancel(); end(false); };
}
export function CarStage({ cfg, id, apiRef, onClick, style, rollIn = false }: { cfg: Cfg; id?: string; apiRef?: React.MutableRefObject<StageApi | null>; onClick?: () => void; style?: React.CSSProperties; rollIn?: boolean }) {
  const { kit } = useApp();
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const first = useRef(cfg);
  const night = useRef(false); // last setNight() value, kept so a re-created stage (e.g. React dev double mount) starts the same
  useEffect(() => {
    const s = (stage.current = new Stage(host.current!, kit, first.current, night.current));
    if (apiRef) apiRef.current = { view: (n) => s.view(n), zoom: (f) => s.zoom(f), pan: (x, y) => s.pan(x, y), zoomed: () => s.zoomed(), angle: (a) => s.angle(a), currentAngle: () => s.currentAngle(), setNight: (on) => { night.current = on; s.setNight(on); } };
    // Only the configurator (which controls the camera) turns the car: fetch the other angles as soon as the browser is idle
    // after the first paint, so the first arrow press doesn't wait for the network.
    const ric = (window as any).requestIdleCallback as ((f: () => void, o?: object) => number) | undefined;
    const t = !apiRef ? 0 : ric ? ric(() => s.preload(true), { timeout: 1500 }) : setTimeout(() => s.preload(true), 300);
    return () => { if (t) (ric ? (window as any).cancelIdleCallback(t) : clearTimeout(t)); s.destroy(); stage.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (rollIn && host.current) return rollInCar(host.current, () => stage.current) || undefined; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { stage.current?.setKit(kit); }, [kit]);
  useEffect(() => { stage.current?.set(cfg); }, [cfg]);
  // Server + first paint: the real car picture (same photo, size and stickers as the Stage's first picture), so the photo
  // appears without waiting for the scripts and nothing shifts when the Stage replaces it. Computed once: React never
  // touches it again (the Stage owns this element's content).
  const [poster] = useState(() => stagePoster(kit, first.current, 'p' + (id || 'car')));
  return <div id={id} ref={host} onClick={onClick} style={style} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: poster }} />;
}
