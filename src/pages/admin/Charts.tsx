/* Small dependency-free charts for the admin dashboard: a trend (area + line) chart with a hover crosshair, a ranked bar list
   and a column chart. One series per chart in the brand accent, recessive grid, values in text colours, every chart has a
   text / table equivalent for screen readers. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Point, Row } from './stats';

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useIso(() => {
    const el = ref.current; if (!el) return;
    const set = () => setW(Math.max(260, Math.round(el.clientWidth)));
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/* "Nice" axis maximum and 4 ticks. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export function TrendChart({ points, value, fmtValue, fmtX, fmtTip, label, empty }: {
  points: Point[]; value: (p: Point) => number; fmtValue: (v: number) => string; fmtX: (p: Point) => string;
  fmtTip: (p: Point) => ReactNode; label: string; empty: string;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 220, L = 56, R = 12, Tp = 12, B = 26, iw = W - L - R, ih = H - Tp - B;
  const vals = points.map(value), max = niceMax(Math.max(0, ...vals));
  const x = (i: number) => L + (points.length <= 1 ? iw / 2 : (i * iw) / (points.length - 1));
  const y = (v: number) => Tp + ih - (v / max) * ih;
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = points.length ? `${line}L${x(points.length - 1).toFixed(1)},${Tp + ih}L${x(0).toFixed(1)},${Tp + ih}Z` : '';
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(iw / 70))));
  const allZero = vals.every((v) => v === 0);

  function move(clientX: number, el: SVGSVGElement) {
    const r = el.getBoundingClientRect(), px = ((clientX - r.left) / r.width) * W;
    if (points.length < 1) return;
    const i = points.length === 1 ? 0 : Math.round(((px - L) / iw) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }
  const hp = hover !== null ? points[hover] : null;
  const tipLeft = hover !== null ? Math.min(Math.max(x(hover), 80), W - 80) : 0;

  return (
    <div className="ch" ref={ref}>
      {allZero && <p className="ch-empty">{empty}</p>}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}
        onMouseMove={(e) => move(e.clientX, e.currentTarget)} onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => move(e.touches[0].clientX, e.currentTarget)} onTouchMove={(e) => move(e.touches[0].clientX, e.currentTarget)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="ch-grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text className="ch-axis" x={L - 8} y={y(t) + 4} textAnchor="end">{fmtValue(t)}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const last = points.length - 1, show = i === last || (i % every === 0 && last - i >= every * 0.75);
          return show ? <text key={p.key} className="ch-axis" x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}>{fmtX(p)}</text> : null;
        })}
        {!allZero && <path className="ch-area" d={area} />}
        {!allZero && <path className="ch-line" d={line} />}
        {hp && hover !== null && (
          <g>
            <line className="ch-cross" x1={x(hover)} x2={x(hover)} y1={Tp} y2={Tp + ih} />
            <circle className="ch-dot" cx={x(hover)} cy={y(vals[hover])} r={5} />
          </g>
        )}
      </svg>
      {hp && <div className="ch-tip" style={{ left: tipLeft }} role="presentation">{fmtTip(hp)}</div>}
    </div>
  );
}

/* Ranked horizontal bars with the value written at the end; hovering a row shows the secondary figure. */
export function BarList({ rows, fmt, fmtSub, empty, swatches }: { rows: Row[]; fmt: (v: number) => string; fmtSub?: (r: Row) => string; empty: string; swatches?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="ch-empty">{empty}</p>;
  return (
    <ol className="bl">
      {rows.map((r) => (
        <li key={r.key} title={fmtSub ? `${r.label}: ${fmt(r.value)} · ${fmtSub(r)}` : `${r.label}: ${fmt(r.value)}`}>
          <span className="bl-label">{swatches && r.swatch && <i className="bl-sw" style={{ background: r.swatch }} aria-hidden="true" />}{r.label}</span>
          <span className="bl-track" aria-hidden="true"><span className="bl-bar" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></span>
          <span className="bl-val">{fmt(r.value)}{fmtSub && <small>{fmtSub(r)}</small>}</span>
        </li>
      ))}
    </ol>
  );
}

/* Vertical columns (weekdays, hours). The busiest column is labelled; the rest show their value on hover / tap. */
export function Columns({ values, labels, fmt, label }: { values: number[]; labels: string[]; fmt: (v: number) => string; label: string }) {
  const max = Math.max(1, ...values), best = values.indexOf(Math.max(...values));
  const [hover, setHover] = useState<number | null>(null);
  const summary = useMemo(() => labels.map((l, i) => `${l}: ${fmt(values[i])}`).join(', '), [labels, values, fmt]);
  return (
    <div className="cols" role="img" aria-label={`${label}. ${summary}`} onMouseLeave={() => setHover(null)}>
      {values.map((v, i) => (
        <div key={i} className={'col' + (hover === i ? ' on' : '')} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
          <span className="col-v">{(hover === i || (hover === null && i === best && v > 0)) ? fmt(v) : ''}</span>
          <span className="col-track"><span className="col-bar" style={{ height: `${v ? Math.max(3, (v / max) * 100) : 0}%` }} /></span>
          <span className="col-l">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}
