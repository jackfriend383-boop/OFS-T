import { useState } from 'react';
import { useApp } from '../state';
import { COPY } from '../content';
import { CATS } from '../lib/kit';
import { DesignCard, FilterTabs } from '../components/DesignCard';
import { useFilterFeedback } from '../lib/filter';

export default function Shop() {
  const { kit, lang } = useApp();
  const c = COPY[lang].shop;
  const [cat, setCat] = useState('All');
  const shown = kit.DESIGNS.filter((d) => cat === 'All' || d.cat === cat);
  useFilterFeedback(cat, '#shopGrid .dcard', shown.length);
  return (
    <section className="view" data-view="shop">
      <div className="page-head">
        <span className="eyebrow">{c.eyebrow}</span>
        <h1 className="display">{c.h1}</h1>
        <p className="muted" style={{ margin: 0, maxWidth: '56ch' }}>{c.lead}</p>
        <FilterTabs id="shopTabs" cats={CATS} value={cat} onPick={setCat} label={c.filter} />
      </div>
      <div className="section" style={{ paddingTop: 24 }}>
        <h2 className="sr">{c.designs}</h2>
        <div className="grid-cards" id="shopGrid">{kit.DESIGNS.map((d) => <DesignCard key={d.id} d={d} hidden={cat !== 'All' && d.cat !== cat} />)}</div>
      </div>
    </section>
  );
}
