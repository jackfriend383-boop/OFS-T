import { useState } from 'react';
import { useApp } from '../state';
import { COPY } from '../content';
import { DesignCard, FilterTabs } from '../components/DesignCard';
import { useFilterFeedback } from '../lib/filter';

const OUTLINE = import.meta.env.BASE_URL + 'assets/img/design-outline.svg';

/* The shop shows one liquid-glass box per design: the name (white, bold) on the left, fading into the design's black outline on the
   right. Clicking a box opens its 4 most popular colour combinations underneath; clicking again (or another box) closes it. */
export default function Shop() {
  const { kit, lang } = useApp();
  const c = COPY[lang].shop;
  const [cat, setCat] = useState('All');
  const [openId, setOpenId] = useState<string | null>(null);
  const POPULAR = kit.presets.slice(0, 4);
  const shown = kit.DESIGNS.filter((d) => cat === 'All' || d.cat === cat);
  useFilterFeedback(cat, '#shopGrid .dbox-item', shown.length);
  return (
    <section className="view" data-view="shop">
      <div className="page-head">
        <span className="eyebrow">{c.eyebrow}</span>
        <h1 className="display">{c.h1}</h1>
        <p className="muted" style={{ margin: 0, maxWidth: '56ch' }}>{c.lead}</p>
        {kit.CATS.length > 2 && <FilterTabs id="shopTabs" cats={kit.CATS} value={cat} onPick={setCat} label={c.filter} />}
      </div>
      <div className="section" style={{ paddingTop: 24 }}>
        <h2 className="sr">{c.designs}</h2>
        <p className="muted dbox-hint">{c.hint}</p>
        <div className="dbox-list" id="shopGrid">
          {kit.DESIGNS.map((d) => {
            const open = openId === d.id, hidden = cat !== 'All' && d.cat !== cat;
            return (
              <div className={'dbox-item' + (hidden ? ' out' : '')} key={d.id} hidden={hidden}>
                <button type="button" className="dbox" aria-expanded={open} aria-controls={'dp-' + d.id} aria-label={c.open(d.name)} onClick={() => setOpenId(open ? null : d.id)}>
                  <span className="dbox-name">{d.name}</span>
                  <span className="dbox-art" aria-hidden="true"><img src={OUTLINE} alt="" loading="lazy" decoding="async" /></span>
                  <span className="dbox-go" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="m6 9 6 6 6-6" /></svg></span>
                </button>
                {open && (
                  <div className="dbox-panel" id={'dp-' + d.id} role="region" aria-label={c.top(d.name)}>
                    <div className="grid-cards">{POPULAR.map((p) => <DesignCard key={d.id + p.id} d={d} preset={p} />)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
