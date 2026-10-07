import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state';
import { Stage, THUMB_PLACEHOLDER, initArt, thumbSVG } from '../lib/car';
import type { Cfg } from '../lib/kit';

/* A car picture with the sticker design on it. Drawn when it comes near the viewport (or near the visible part of the horizontal
   design strip), instead of building every SVG up front. The server renders a same-sized placeholder, so nothing shifts. */
export const Thumb = memo(function Thumb({ cfg, decorative = true, eager = false, className = 'mini' }: { cfg: Cfg; decorative?: boolean; eager?: boolean; className?: string }) {
  const { kit } = useApp();
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(eager);
  useEffect(() => {
    initArt();
    if (shown) return;
    const el = ref.current; if (!el) return;
    if (!('IntersectionObserver' in window)) { setShown(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); } }, { root: el.closest('.strip'), rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  const key = kit.keyOf(cfg) + kit.lang + decorative;
  const html = useMemo(() => (shown ? thumbSVG(kit, cfg, decorative) : THUMB_PLACEHOLDER), [shown, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref} className={className || undefined} style={{ display: 'block' }} dangerouslySetInnerHTML={{ __html: html }} />;
});

/* The live car (hero + configurator). The Stage animates its own SVG; React only owns the host element. */
export interface StageApi { replay: () => void; view: (name: string) => void; zoom: (f: number) => void; pan: (dx: number, dy: number) => void; zoomed: () => boolean }
export function CarStage({ cfg, id, apiRef, onClick, style }: { cfg: Cfg; id?: string; apiRef?: React.MutableRefObject<StageApi | null>; onClick?: () => void; style?: React.CSSProperties }) {
  const { kit } = useApp();
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const first = useRef(cfg);
  useEffect(() => {
    initArt();
    const s = (stage.current = new Stage(host.current!, kit, first.current));
    if (apiRef) apiRef.current = { replay: () => s.driveIn(), view: (n) => s.view(n), zoom: (f) => s.zoom(f), pan: (x, y) => s.pan(x, y), zoomed: () => s.zoomed() };
    s.driveIn();
    return () => { s.destroy(); stage.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { stage.current?.setKit(kit); }, [kit]);
  useEffect(() => { stage.current?.set(cfg); }, [cfg]);
  // Server + first paint: an empty car-shaped box with the same aspect ratio as the live SVG.
  return (
    <div id={id} ref={host} onClick={onClick} style={style} suppressHydrationWarning>
      <svg className="car-svg" viewBox="530 250 1080 646" aria-hidden="true" focusable="false" />
    </div>
  );
}
