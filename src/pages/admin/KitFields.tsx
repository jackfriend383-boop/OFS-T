/* Admin: the fields that describe one kit (design, Ami version, the two colours, window shape, kit contents).
   Used by the Print files tab (manual download) and by the "New order" form. Colours are the same palette the configurator offers. */
import { useId } from 'react';
import { useApp } from '../../state';
import { DASH } from './copy';
import { DEFAULT_WIN_SHAPE, PIECES, WIN_SHAPES, normPieces, normWinShape, type Cfg, type Piece } from '../../lib/kit';

/* A kit config for a design with the design's own colours. */
export const baseCfg = (kit: ReturnType<typeof useApp>['kit'], design: string): Cfg => kit.defaultCfg(kit.D(design) || kit.DESIGNS[0]);

export default function KitFields({ cfg, onChange }: { cfg: Cfg; onChange: (c: Cfg) => void }) {
  const { kit, T, lang } = useApp();
  const d = DASH[lang], id = useId();
  const design = kit.D(cfg.design), fixed = !!design?.fixed;
  const keys = Object.keys(kit.COLORS);
  const classic = keys.filter((k) => !kit.COLORS[k].metal), metal = keys.filter((k) => kit.COLORS[k].metal);
  const parts: Piece[] = PIECES;
  const colourSelect = (field: 'c1' | 'c2', label: string) => (
    <div className="co-f">
      <label htmlFor={`${id}-${field}`}>{label}</label>
      <div className="kf-colour">
        <span className="kf-sw" style={{ background: kit.COLORS[cfg[field]]?.hex }} aria-hidden="true" />
        <select className="field" id={`${id}-${field}`} value={cfg[field]} disabled={fixed} onChange={(e) => onChange({ ...cfg, [field]: e.target.value })}>
          <optgroup label={d.mfClassic}>{classic.map((k) => <option key={k} value={k}>{kit.COLORS[k].name}</option>)}</optgroup>
          <optgroup label={d.mfMetal}>{metal.map((k) => <option key={k} value={k}>{kit.COLORS[k].name}</option>)}</optgroup>
        </select>
      </div>
    </div>
  );
  const setModel = (m: 'qs' | 'pop') => onChange({ ...cfg, model: m, winShape: DEFAULT_WIN_SHAPE[m], numberOn: m === 'pop' ? false : cfg.numberOn, pieces: normPieces(cfg.pieces, m, design?.price ?? 0) });
  const setDesign = (did: string) => { const b = baseCfg(kit, did); onChange({ ...cfg, design: did, c1: b.c1, c2: b.c2 }); };
  const shapes = WIN_SHAPES[cfg.model];
  return (
    <div className="kf">
      <div className="co-f">
        <label htmlFor={`${id}-design`}>{d.mfDesign}</label>
        <select className="field" id={`${id}-design`} value={cfg.design} onChange={(e) => setDesign(e.target.value)}>{kit.DESIGNS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      </div>
      <div className="co-f">
        <label htmlFor={`${id}-model`}>{d.mfModel}</label>
        <select className="field" id={`${id}-model`} value={cfg.model} onChange={(e) => setModel(e.target.value as 'qs' | 'pop')}>
          <option value="qs">{kit.modelName('qs')}</option><option value="pop">{kit.modelName('pop')}</option>
        </select>
      </div>
      {colourSelect('c1', d.mfC1)}
      {colourSelect('c2', d.mfC2)}
      <div className="co-f">
        <label htmlFor={`${id}-win`}>{d.mfWin}</label>
        <select className="field" id={`${id}-win`} value={normWinShape(cfg.winShape, cfg.model)} disabled={shapes.length < 2} onChange={(e) => onChange({ ...cfg, winShape: e.target.value as Cfg['winShape'] })}>
          {shapes.map((s) => <option key={s} value={s}>{T('winShape_' + s)}</option>)}
        </select>
      </div>
      <div className="co-f">
        <label htmlFor={`${id}-parts`}>{d.mfParts}</label>
        <select className="field" id={`${id}-parts`} value={cfg.pieces.includes('full') ? 'full' : cfg.pieces[0] || 'full'} onChange={(e) => onChange({ ...cfg, pieces: [e.target.value as Piece] })}>
          {parts.map((p) => <option key={p} value={p}>{T('pc_' + p)}</option>)}
        </select>
      </div>
      {fixed && <p className="adm-note kf-wide">{d.mfFixed}</p>}
    </div>
  );
}
