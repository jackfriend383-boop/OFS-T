/* Admin "Designs" tab: add a design (upload its print master SVG), change price / name / colours, hide or show it in the shop,
   delete one you added. The built-in design (Launch Edition) can be changed and hidden but not deleted (it lives in the site's files).
   Everything typed or uploaded here is checked again by the shop's server (worker/src/designs.ts). */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useApp } from '../../state';
import DATA from '../../data/designs.json';
import { DEFAULT_FRAME, outlineUrl } from '../../lib/outline';
import { artPictures, dropMasterCache, inspectMaster, moldSVG, setRemoteMaster } from '../../lib/printfile';

const COLORS = DATA.colors as Record<string, { name: string; hex: string }>;
const BUILTIN = DATA.designs as { id: string; name: string; tag: string; cat: string; price: number; c1: string; c2: string; fixed?: boolean }[];
const CATS = ['Launch Edition'];

const TXT = {
  en: {
    title: 'Designs', note: 'Add a design by uploading its print master (SVG). It appears in the shop and the configurator straight away and is priced by the server.',
    add: 'Add a design', builtin: 'Built-in', custom: 'Added by you', visible: 'Visible', hidden: 'Hidden', hide: 'Hide', show: 'Show', edit: 'Edit', del: 'Delete', reset: 'Reset to original',
    confirmDel: (n: string) => `Delete "${n}" for good? It disappears from the shop. Past orders keep their files.`, confirmReset: (n: string) => `Put "${n}" back to its original settings?`,
    name: 'Name', tagEn: 'Tagline (English)', tagPt: 'Tagline (Portuguese)', cat: 'Category', price: 'Full kit price (€)', c1: 'Default colour 1', c2: 'Default colour 2',
    fixed: 'Fixed colours (prints exactly as drawn, customers cannot recolour)', file: 'Print master (SVG, 746 × 285 mm + bleed)', fileKeep: 'Choose a file only if you want to replace the artwork.',
    checking: 'Checking the file…', okFile: (r: boolean) => (r ? 'File OK. Colours can be changed by customers.' : 'File OK. It has no recolour parts, so it is saved as fixed colours.'),
    save: 'Save', cancel: 'Cancel', saving: 'Saving…', saved: 'Saved. Reloading…', deleted: 'Done. Reloading…', failed: 'That did not work. Check the fields and try again.',
    needFile: 'Choose the SVG file first.', needName: 'Give the design a name.', bigPic: 'The preview picture is too big. Simplify the artwork and try again.', loading: 'Loading designs…', notReady: 'The shop server has no designs table yet (run the 0009 migration).',
    preview: 'Preview', none: 'No designs yet.',
    boxTitle: 'Shop box', boxColour: 'Frame colour (the border around the box)', outline: 'Outline picture (SVG)', outlineNote: 'The line drawing shown on the right of the design box. Leave empty to keep the current one.', outlineScale: 'Outline size', thick: 'Draw the lines black and thick (recommended)', removeOutline: 'Remove my outline (use the default)', boxPrev: 'How the box looks in the shop', badSvg: 'That file is not a usable SVG.', zoomReset: 'Reset size',
  },
  pt: {
    title: 'Designs', note: 'Adiciona um design carregando o respetivo ficheiro de impressão (SVG). Aparece na loja e no configurador de imediato e o preço é calculado pelo servidor.',
    add: 'Adicionar design', builtin: 'Incluído', custom: 'Adicionado por ti', visible: 'Visível', hidden: 'Oculto', hide: 'Ocultar', show: 'Mostrar', edit: 'Editar', del: 'Eliminar', reset: 'Repor original',
    confirmDel: (n: string) => `Eliminar "${n}" definitivamente? Deixa de aparecer na loja. As encomendas passadas mantêm os ficheiros.`, confirmReset: (n: string) => `Repor "${n}" para as definições originais?`,
    name: 'Nome', tagEn: 'Frase (inglês)', tagPt: 'Frase (português)', cat: 'Categoria', price: 'Preço do kit completo (€)', c1: 'Cor predefinida 1', c2: 'Cor predefinida 2',
    fixed: 'Cores fixas (imprime tal como desenhado, o cliente não pode mudar as cores)', file: 'Ficheiro de impressão (SVG, 746 × 285 mm + sangria)', fileKeep: 'Só escolhe um ficheiro se quiseres substituir o desenho.',
    checking: 'A verificar o ficheiro…', okFile: (r: boolean) => (r ? 'Ficheiro OK. Os clientes podem mudar as cores.' : 'Ficheiro OK. Não tem partes recoloríveis, por isso fica com cores fixas.'),
    save: 'Guardar', cancel: 'Cancelar', saving: 'A guardar…', saved: 'Guardado. A recarregar…', deleted: 'Feito. A recarregar…', failed: 'Não funcionou. Verifica os campos e tenta de novo.',
    needFile: 'Escolhe primeiro o ficheiro SVG.', needName: 'Dá um nome ao design.', bigPic: 'A imagem de pré-visualização é demasiado grande. Simplifica o desenho e tenta de novo.', loading: 'A carregar designs…', notReady: 'O servidor da loja ainda não tem a tabela de designs (executa a migração 0009).',
    preview: 'Pré-visualização', none: 'Ainda não há designs.',
    boxTitle: 'Caixa na loja', boxColour: 'Cor da borda (a moldura à volta da caixa)', outline: 'Imagem do outline (SVG)', outlineNote: 'O desenho de linhas que aparece à direita da caixa do design. Deixa vazio para manter o atual.', outlineScale: 'Tamanho do outline', thick: 'Desenhar as linhas a preto e grossas (recomendado)', removeOutline: 'Remover o meu outline (usar o predefinido)', boxPrev: 'Como a caixa fica na loja', badSvg: 'Esse ficheiro não é um SVG utilizável.', zoomReset: 'Repor tamanho',
  },
};

interface Row { id: string; name: string | null; tag: string | null; tagPt: string | null; cat: string | null; price: number | null; c1: string | null; c2: string | null; fixed: boolean | null; hidden: boolean; custom: boolean; hasMaster: boolean; boxColor?: string | null; outlineScale?: number | null; outlineVer?: number; hasOutline?: boolean }
interface Form { boxColor: string; outlineScale: string; origColor: string; origScale: string; hasOutline: boolean; outlineVer: number; id: string; isNew: boolean; builtin: boolean; name: string; tag: string; tagPt: string; cat: string; price: string; c1: string; c2: string; fixed: boolean; hidden: boolean }

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 38);
const b64 = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

export default function Designs() {
  const { backend, lang } = useApp();
  const t = TXT[lang === 'pt' ? 'pt' : 'en'];
  const [rows, setRows] = useState<Row[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [master, setMaster] = useState<{ text: string; recolourable: boolean } | null>(null);
  const [fileMsg, setFileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  /* Shop box: the outline file chosen now (raw text), the one already saved (blob: address) and the cleaned version drawn in the preview. */
  const [outRaw, setOutRaw] = useState<string | null>(null);
  const [thick, setThick] = useState(true);
  const [removeOut, setRemoveOut] = useState(false);
  const [curOutline, setCurOutline] = useState<string | null>(null);
  const cleaned = useMemo(() => { if (!outRaw) return { svg: null as string | null, err: false }; try { return { svg: cleanOutline(outRaw, thick), err: false }; } catch { return { svg: null, err: true }; } }, [outRaw, thick]);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!cleaned.svg) { setNewUrl(null); return; }
    const u = URL.createObjectURL(new Blob([cleaned.svg], { type: 'image/svg+xml' }));
    setNewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [cleaned.svg]);

  const load = useCallback(async () => {
    setRemoteMaster((id) => backend.designMaster(id));
    try { const list = await backend.listDesigns(); setRows(list as Row[]); setMsg(''); }
    catch { setRows([]); setMsg(t.notReady); }
  }, [backend, t.notReady]);
  useEffect(() => { void load(); }, [load]);

  /* What the shop shows for each built-in design (the server list only has rows for ones that were changed). */
  const all: Row[] = [
    ...BUILTIN.map((b) => {
      const r = (rows || []).find((x) => x.id === b.id);
      return { id: b.id, name: r?.name ?? b.name, tag: r?.tag ?? b.tag, tagPt: r?.tagPt ?? null, cat: r?.cat ?? b.cat, price: r?.price ?? b.price, c1: r?.c1 ?? b.c1, c2: r?.c2 ?? b.c2, fixed: r?.fixed ?? !!b.fixed, hidden: !!r?.hidden, custom: false, hasMaster: true, boxColor: r?.boxColor ?? null, outlineScale: r?.outlineScale ?? null, outlineVer: r?.outlineVer ?? 0, hasOutline: !!r?.hasOutline, changed: !!r } as Row & { changed: boolean };
    }),
    ...(rows || []).filter((r) => r.custom),
  ];

  const open = (r?: Row) => {
    setMaster(null); setFileMsg(null); setMsg(''); setOutRaw(null); setThick(true); setRemoveOut(false); setCurOutline(null);
    if (r && r.hasOutline) backend.designOutlineBlob(r.id, r.outlineVer || 1).then(setCurOutline).catch(() => setCurOutline(null));
    if (!r) { setForm({ boxColor: DEFAULT_FRAME, outlineScale: '100', origColor: DEFAULT_FRAME, origScale: '100', hasOutline: false, outlineVer: 0, id: '', isNew: true, builtin: false, name: '', tag: '', tagPt: '', cat: CATS[0], price: '69', c1: 'flame', c2: 'crimson', fixed: false, hidden: false }); return; }
    setForm({ boxColor: r.boxColor || DEFAULT_FRAME, outlineScale: String(r.outlineScale || 100), origColor: r.boxColor || DEFAULT_FRAME, origScale: String(r.outlineScale || 100), hasOutline: !!r.hasOutline, outlineVer: r.outlineVer || 0, id: r.id, isNew: false, builtin: !r.custom, name: r.name || '', tag: r.tag || '', tagPt: r.tagPt || '', cat: r.cat || CATS[0], price: String(r.price ?? ''), c1: r.c1 || 'flame', c2: r.c2 || 'crimson', fixed: !!r.fixed, hidden: r.hidden });
  };

  async function pick(file: File | undefined) {
    setMaster(null); setFileMsg(null);
    if (!file) return;
    setFileMsg({ ok: true, text: t.checking });
    try {
      if (file.size > 3_000_000) throw new Error('This file is too big (over 3 MB). Simplify the artwork and try again.');
      const text = await file.text();
      const info = inspectMaster(text);
      const mode = form?.fixed || !info.recolourable ? 'rgb' : 'mask';
      await artPictures(text, mode); // makes sure the shop pictures can be drawn from this file
      setMaster({ text, recolourable: info.recolourable });
      setFileMsg({ ok: true, text: t.okFile(info.recolourable) });
      if (!info.recolourable) setForm((f) => f && { ...f, fixed: true });
    } catch (e: any) { setFileMsg({ ok: false, text: String(e && e.message || t.failed) }); }
  }

  async function pickOutline(file: File | undefined) {
    setOutRaw(null); setRemoveOut(false);
    if (!file) return;
    if (file.size > 3_000_000) { setMsg(t.badSvg); return; }
    setOutRaw(await file.text());
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form || busy) return;
    if (!form.name.trim()) { setMsg(t.needName); return; }
    if (form.isNew && !master) { setMsg(t.needFile); return; }
    setBusy(true); setMsg(t.saving);
    try {
      const id = form.isNew ? uniqueId(slug(form.name) || 'design', all) : form.id;
      const body: Record<string, unknown> = { name: form.name.trim(), tag: form.tag.trim(), tagPt: form.tagPt.trim(), cat: form.cat.trim() || CATS[0], price: Number(form.price), c1: form.c1, c2: form.c2 };
      if (!form.builtin) body.fixed = form.fixed;
      if (form.boxColor !== form.origColor) body.boxColor = form.boxColor;
      if (form.outlineScale !== form.origScale) body.outlineScale = Number(form.outlineScale);
      if (outRaw) { if (!cleaned.svg) { setMsg(t.badSvg); setBusy(false); return; } body.outline = cleaned.svg; }
      else if (removeOut && form.hasOutline) body.outline = null;
      if (master) {
        // A fixed design's picture is shown as drawn; a recolourable one is a tone mask. Rebuild if the choice changed after choosing the file.
        const mode = form.fixed || !master.recolourable ? 'rgb' : 'mask';
        const pics = await artPictures(master.text, mode);
        const [a, b] = [await b64(pics.w1000), await b64(pics.w1600)];
        if (a.length > 400_000 || b.length > 400_000) { setMsg(t.bigPic); setBusy(false); return; }
        body.master = master.text; body.art1000 = a; body.art1600 = b;
      }
      await backend.saveDesign(id, body);
      dropMasterCache(id);
      setMsg(t.saved); setTimeout(() => location.reload(), 700);
    } catch { setMsg(t.failed); setBusy(false); }
  }

  async function flip(r: Row) {
    setBusy(true);
    try { await backend.saveDesign(r.id, { hidden: !r.hidden }); setMsg(t.saved); setTimeout(() => location.reload(), 500); }
    catch { setMsg(t.failed); setBusy(false); }
  }
  async function remove(r: Row) {
    if (!confirm(r.custom ? t.confirmDel(r.name || r.id) : t.confirmReset(r.name || r.id))) return;
    setBusy(true);
    try { await backend.deleteDesign(r.id); dropMasterCache(r.id); setMsg(t.deleted); setTimeout(() => location.reload(), 500); }
    catch { setMsg(t.failed); setBusy(false); }
  }

  const set = (k: keyof Form, v: string | boolean) => setForm((f) => f && { ...f, [k]: v });
  const colourOpts = Object.entries(COLORS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>);

  return (
    <section className="adm-tool adm-designs" aria-labelledby="admDesignsTitle">
      <h2 id="admDesignsTitle">{t.title}</h2>
      <p className="adm-note">{t.note}</p>
      <div className="adm-bar"><button className="btn btn-primary" type="button" onClick={() => open()} disabled={busy}>{t.add}</button></div>
      <p className="adm-note" role="status" aria-live="polite">{msg}</p>
      {rows === null && <p className="adm-empty">{t.loading}</p>}

      <ul className="dz-list">
        {all.map((r) => (
          <li key={r.id} className="dz-row" data-hidden={r.hidden || undefined}>
            <div className="dz-main">
              <b>{r.name}</b> <span className="adm-note">{r.id}</span>
              <div className="adm-note">€{r.price} · {r.custom ? t.custom : t.builtin} · {r.hidden ? t.hidden : t.visible}</div>
            </div>
            <div className="btns">
              <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => open(r)}>{t.edit}</button>
              <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => flip(r)}>{r.hidden ? t.show : t.hide}</button>
              {(r.custom || (r as any).changed) && <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => remove(r)}>{r.custom ? t.del : t.reset}</button>}
            </div>
          </li>
        ))}
        {rows !== null && !all.length && <li className="adm-empty">{t.none}</li>}
      </ul>

      {form && (
        <form className="adm-panel dz-form" onSubmit={save} noValidate>
          <h3>{form.isNew ? t.add : t.edit + ': ' + form.id}</h3>
          <div className="co-f"><label htmlFor="dzName">{t.name}</label><input className="field" id="dzName" value={form.name} maxLength={60} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="co-f"><label htmlFor="dzTag">{t.tagEn}</label><input className="field" id="dzTag" value={form.tag} maxLength={120} onChange={(e) => set('tag', e.target.value)} /></div>
          <div className="co-f"><label htmlFor="dzTagPt">{t.tagPt}</label><input className="field" id="dzTagPt" value={form.tagPt} maxLength={120} onChange={(e) => set('tagPt', e.target.value)} /></div>
          <div className="co-f"><label htmlFor="dzCat">{t.cat}</label><input className="field" id="dzCat" list="dzCats" value={form.cat} maxLength={30} onChange={(e) => set('cat', e.target.value)} /><datalist id="dzCats">{[...new Set([...CATS, ...all.map((r) => r.cat || '')])].filter(Boolean).map((c) => <option key={c} value={c} />)}</datalist></div>
          <div className="co-f"><label htmlFor="dzPrice">{t.price}</label><input className="field" id="dzPrice" type="number" min={1} max={999} step={1} inputMode="numeric" value={form.price} onChange={(e) => set('price', e.target.value)} /></div>
          <div className="co-f"><label htmlFor="dzC1">{t.c1}</label><select className="field" id="dzC1" value={form.c1} onChange={(e) => set('c1', e.target.value)}>{colourOpts}</select></div>
          <div className="co-f"><label htmlFor="dzC2">{t.c2}</label><select className="field" id="dzC2" value={form.c2} onChange={(e) => set('c2', e.target.value)}>{colourOpts}</select></div>
          {!form.builtin && <label className="dz-check"><input type="checkbox" checked={form.fixed} disabled={!!master && !master.recolourable} onChange={(e) => set('fixed', e.target.checked)} /> {t.fixed}</label>}
          {!form.builtin && (
            <div className="co-f">
              <label htmlFor="dzFile">{t.file}</label>
              <input className="field" id="dzFile" type="file" accept=".svg,image/svg+xml" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
              {!form.isNew && <span className="adm-note">{t.fileKeep}</span>}
              {fileMsg && <span className={fileMsg.ok ? 'adm-note' : 'err'} role="status">{fileMsg.text}</span>}
              {master && <div className="moldp dz-prev" aria-label={t.preview} dangerouslySetInnerHTML={{ __html: moldSVG(master.text, form.fixed || !master.recolourable ? null : COLORS[form.c1]?.hex || null, form.fixed || !master.recolourable ? null : COLORS[form.c2]?.hex || null) }} />}
            </div>
          )}
          <fieldset className="dz-box">
            <legend>{t.boxTitle}</legend>
            <div className="co-f"><label htmlFor="dzBox">{t.boxColour}</label>
              <div className="dz-colour"><input id="dzBox" type="color" value={form.boxColor} onChange={(e) => set('boxColor', e.target.value)} /><code>{form.boxColor}</code></div>
            </div>
            <div className="co-f">
              <label htmlFor="dzOutline">{t.outline}</label>
              <input className="field" id="dzOutline" type="file" accept=".svg,image/svg+xml" onChange={(e) => { void pickOutline(e.target.files?.[0]); e.target.value = ''; }} />
              <span className="adm-note">{t.outlineNote}</span>
              {cleaned.err && <span className="err" role="status">{t.badSvg}</span>}
              <label className="dz-check"><input type="checkbox" checked={thick} onChange={(e) => setThick(e.target.checked)} /> {t.thick}</label>
              {form.hasOutline && !outRaw && <label className="dz-check"><input type="checkbox" checked={removeOut} onChange={(e) => setRemoveOut(e.target.checked)} /> {t.removeOutline}</label>}
            </div>
            <div className="co-f">
              <label htmlFor="dzScale">{t.outlineScale}: {form.outlineScale}%</label>
              <input id="dzScale" type="range" min={40} max={220} step={5} value={form.outlineScale} onChange={(e) => set('outlineScale', e.target.value)} />
            </div>
            <div className="co-f">
              <span className="adm-note">{t.boxPrev}</span>
              <div className="dbox-frame" style={{ '--frame': form.boxColor, '--oscale': Number(form.outlineScale) / 100 } as CSSProperties}>
                <div className="dbox">
                  <span className="dbox-name">{form.name || '…'}</span>
                  <span className="dbox-art" aria-hidden="true"><img alt="" src={newUrl || (removeOut ? outlineUrl('') : curOutline) || outlineUrl('')} /></span>
                </div>
              </div>
            </div>
          </fieldset>
          <div className="adm-bar">
            <button className="btn btn-primary" type="submit" disabled={busy}>{t.save}</button>
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => { setForm(null); setMaster(null); setFileMsg(null); setMsg(''); }}>{t.cancel}</button>
          </div>
        </form>
      )}
    </section>
  );
}

/* Makes an uploaded outline safe and tidy before it is saved: drops scripts, pictures, editor metadata and anything that points outside
   the file, gives it a size (so it can be drawn at any height) and, if asked, draws every line black and thick. */
function cleanOutline(raw: string, thick: boolean): string {
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('bad');
  const DROP = new Set(['script', 'foreignobject', 'image', 'metadata', 'style', 'title', 'desc', 'a', 'use', 'animate', 'animatetransform', 'animatemotion', 'set', 'iframe', 'embed', 'object', 'link', 'meta', 'base']);
  for (const el of Array.from(svg.querySelectorAll('*'))) { if (DROP.has(el.localName.toLowerCase()) || el.nodeName.includes(':')) el.remove(); }
  for (const el of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || n.includes(':') && !n.startsWith('xmlns') || n === 'xmlns:inkscape' || n === 'xmlns:sodipodi' || n === 'xml:space' || (n === 'href' && !a.value.trim().startsWith('#'))) el.removeAttribute(a.name);
      else if (n.startsWith('xmlns:')) el.removeAttribute(a.name);
    }
  }
  let vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((x) => !Number.isFinite(x)) || vb[2] <= 0 || vb[3] <= 0) {
    const w = parseFloat(svg.getAttribute('width') || ''), h = parseFloat(svg.getAttribute('height') || '');
    if (!(w > 0 && h > 0)) throw new Error('no size');
    vb = [0, 0, w, h]; svg.setAttribute('viewBox', vb.join(' '));
  }
  svg.setAttribute('width', String(vb[2])); svg.setAttribute('height', String(vb[3]));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  if (thick) {
    const st = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
    st.textContent = `path,line,polyline,polygon,circle,ellipse,rect{stroke:#000!important;stroke-width:${Math.round((vb[2] / 741) * 40) / 10}px!important;stroke-opacity:1!important}`;
    svg.insertBefore(st, svg.firstChild);
  }
  return new XMLSerializer().serializeToString(svg);
}

function uniqueId(base: string, all: { id: string }[]) {
  let id = base.length < 2 ? base + '-1' : base, n = 2;
  while (all.some((r) => r.id === id)) id = base.slice(0, 35) + '-' + n++;
  return id;
}
