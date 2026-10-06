/* Design search: a combobox + listbox inside a modal dialog. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../state';
import { Thumb } from './Car';

export function SearchDialog() {
  const { kit, T, to, modal, closeModal, announce, live, onPickDesign } = useApp();
  const navigate = useNavigate();
  const open = modal === 'search';
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const [kb, setKb] = useState(false);
  const [built, setBuilt] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const money = kit.money;

  useEffect(() => { if (open) { setBuilt(true); setQ(''); setHl(0); setKb(false); } }, [open]);
  const query = q.trim().toLowerCase();
  const shown = useMemo(() => kit.DESIGNS.filter((d) => !query || [d.name, d.tag, d.cat, d.catName || ''].join(' ').toLowerCase().includes(query)), [kit, query]);
  useEffect(() => { setHl(0); if (query) announce(shown.length ? T.n('found', shown.length) : T('noneFound'), 'sresCount'); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = shown[Math.min(hl, shown.length - 1)];

  function pick(id: string) {
    if (!kit.D(id)) return;
    closeModal();
    if (onPickDesign.current) onPickDesign.current(id); else navigate(to('configurator', 'design=' + encodeURIComponent(id)));
  }
  function move(step: number, scroll = true) {
    if (!shown.length) return;
    const i = (hl + step + shown.length) % shown.length;
    setHl(i);
    if (scroll) requestAnimationFrame(() => list.current?.querySelector('.hl')?.scrollIntoView({ block: 'nearest' }));
  }
  return (
    <div className={'search' + (open ? ' on' : '')} id="search" role="dialog" aria-modal="true" aria-label={kit.L.ui.t_search}>
      <input id="searchInput" type="text" role="combobox" aria-autocomplete="list" aria-expanded={shown.length ? 'true' : 'false'} aria-controls="slist"
        aria-activedescendant={cur ? 'sopt-' + cur.id : undefined} placeholder={kit.L.ui.t_search_ph} autoComplete="off" spellCheck={false} aria-label={kit.L.ui.t_search}
        value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setKb(true); move(e.key === 'ArrowDown' ? 1 : -1); }
          else if (e.key === 'Enter') { e.preventDefault(); if (cur) pick(cur.id); }
        }} />
      <div className={'sres' + (kb ? ' kb' : '')} id="sres">
        <div id="slist" role="listbox" aria-label={kit.L.ui.t_designs} ref={list}>
          {built && kit.DESIGNS.map((d) => {
            const vis = shown.includes(d), sel = cur === d;
            return (
              <button key={d.id} type="button" role="option" tabIndex={-1} id={'sopt-' + d.id} hidden={!vis} aria-selected={vis && sel} className={vis && sel ? 'hl' : undefined} onClick={() => pick(d.id)}>
                <span className="mini" aria-hidden="true"><Thumb cfg={kit.defaultCfg(d)} className="" eager={open} /></span>
                <span><b>{d.name}</b><small>{d.catName || d.cat} · {d.tag} · {money(d.price)}</small></span>
              </button>
            );
          })}
        </div>
        <p className="muted" id="sempty" style={{ padding: 14, margin: 0 }} hidden={!!shown.length}>{shown.length ? '' : T('searchNone', { q: q.trim() })}</p>
      </div>
      <p className="sr" id="sresCount" role="status" aria-live="polite">{live.sresCount}</p>
    </div>
  );
}
