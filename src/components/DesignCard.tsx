import { Link, useNavigate } from 'react-router';
import { useApp } from '../state';
import type { Design, Kit, Preset } from '../lib/kit';
import { Thumb } from './Car';

export const FilterTabs = ({ cats, value, onPick, label, id }: { cats: string[]; value: string; onPick: (c: string) => void; label: string; id: string }) => {
  const { kit } = useApp();
  return (
    <div className="tabs" role="group" id={id} aria-label={label}>
      {cats.map((c) => <button key={c} type="button" aria-pressed={value === c} data-c={c} onClick={() => onPick(c)}>{kit.T.cat(c)}</button>)}
    </div>
  );
};

/* "Graphite / Mint": the colour names of a preset, in the page language. */
export const presetLabel = (_kit: Kit, p: { label: string }) => p.label;

/* Home + shop design card: one colourway of a design (no price, no quick add), only "Customize"; click anywhere opens the configurator
   with that design and those two colours. */
export function DesignCard({ d, preset, hidden }: { d: Design; preset: Preset; hidden?: boolean }) {
  const { kit, to } = useApp();
  const navigate = useNavigate();
  const b = kit.L.build;
  const label = presetLabel(kit, preset);
  const href = to('configurator', 'design=' + encodeURIComponent(d.id) + '&c1=' + encodeURIComponent(preset.c1) + '&c2=' + encodeURIComponent(preset.c2));
  return (
    <article className={'dcard' + (hidden ? ' out' : '')} data-id={d.id} data-cat={d.cat} data-preset={preset.id}
      onClick={(e) => { if ((e.target as HTMLElement).closest('a,button')) return; navigate(href); }}>
      <Thumb cfg={kit.presetCfg(d.id, preset.id) ?? kit.defaultCfg(d)} />
      <div className="dcard-row"><h3>{d.name}</h3><span className="eyebrow">{d.catName}</span></div>
      <div className="dcard-row"><span className="tag">{label}</span></div>
      <div className="dcard-actions">
        <Link className="btn btn-primary" to={href} aria-label={b.customize_aria.replace('{name}', d.name + ' (' + label + ')')}>{b.customize}</Link>
      </div>
    </article>
  );
}
