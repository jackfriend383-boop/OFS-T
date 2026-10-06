import { Link, useNavigate } from 'react-router';
import { useApp } from '../state';
import type { Design } from '../lib/kit';
import { Thumb } from './Car';

export const FilterTabs = ({ cats, value, onPick, label, id }: { cats: string[]; value: string; onPick: (c: string) => void; label: string; id: string }) => {
  const { kit } = useApp();
  return (
    <div className="tabs" role="group" id={id} aria-label={label}>
      {cats.map((c) => <button key={c} type="button" aria-pressed={value === c} data-c={c} onClick={() => onPick(c)}>{kit.T.cat(c)}</button>)}
    </div>
  );
};

/* Home + shop design card: Customize / Quick add / click anywhere. */
export function DesignCard({ d, hidden }: { d: Design; hidden?: boolean }) {
  const { kit, to, addToCart } = useApp();
  const navigate = useNavigate();
  const b = kit.L.build;
  const href = to('configurator', 'design=' + encodeURIComponent(d.id));
  return (
    <article className={'dcard' + (hidden ? ' out' : '')} data-id={d.id} data-cat={d.cat}
      onClick={(e) => { if ((e.target as HTMLElement).closest('a,button')) return; navigate(href); }}>
      <Thumb cfg={kit.defaultCfg(d)} />
      <div className="dcard-row"><h3>{d.name}</h3><span className="price">{kit.money(d.price)}</span></div>
      <div className="dcard-row"><span className="tag">{d.tag}</span><span className="eyebrow">{d.catName}</span></div>
      <div className="dcard-actions">
        <Link className="btn btn-primary" to={href} aria-label={b.customize_aria.replace('{name}', d.name)}>{b.customize}</Link>
        <button className="btn btn-ghost" type="button" aria-label={b.quick_add_aria.replace('{name}', d.name)} onClick={() => addToCart(kit.defaultCfg(d))}>{b.quick_add}</button>
      </div>
    </article>
  );
}
