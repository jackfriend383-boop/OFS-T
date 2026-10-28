/* Admin "Designs" tab: add a design (upload its print master SVG), change price / name / colours, hide or show it in the shop,
   delete one you added. The two built-in designs can be changed and hidden but not deleted (they live in the site's files).
   Everything typed or uploaded here is checked again by the shop's server (worker/src/designs.ts). */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../../state';
import DATA from '../../data/designs.json';
import { artPictures, dropMasterCache, inspectMaster, moldSVG, setRemoteMaster } from '../../lib/printfile';

const COLORS = DATA.colors as Record<string, { name: string; hex: string }>;
const BUILTIN = DATA.designs as { id: string; name: string; tag: string; cat: string; price: number; c1: string; c2: string; fixed?: boolean }[];
const CATS = ['Signature'];

const TXT = {
  en: {
    title: 'Designs', note: 'Add a design by uploading its print master (SVG). It appears in the shop and the configurator straight away and is priced by the server.',
    add: 'Add a design', builtin: 'Built-in', custom: 'Added by you', visible: 'Visible', hidden: 'Hidden', hide: 'Hide', show: 'Show', edit: 'Edit', del: 'Delete', reset: 'Reset to original',
    confirmDel: (n: string) => `Delete "${n}" for good? It disappears from the shop. Past orders keep their files.`, confirmReset: (n: string) => `Put "${n}" back to its original settings?`,
    name: 'Name', tagEn: 'Tagline (English)', tagPt: 'Tagline (Portuguese)', cat: 'Category', price: 'Price per side (€)', c1: 'Default colour 1', c2: 'Default colour 2',
    fixed: 'Fixed colours (prints exactly as drawn, customers cannot recolour)', file: 'Print master (SVG, 746 × 285 mm + bleed)', fileKeep: 'Choose a file only if you want to replace the artwork.',
    checking: 'Checking the file…', okFile: (r: boolean) => (r ? 'File OK. Colours can be changed by customers.' : 'File OK. It has no recolour parts, so it is saved as fixed colours.'),
    save: 'Save', cancel: 'Cancel', saving: 'Saving…', saved: 'Saved. Reloading…', deleted: 'Done. Reloading…', failed: 'That did not work. Check the fields and try again.',
    needFile: 'Choose the SVG file first.', needName: 'Give the design a name.', bigPic: 'The preview picture is too big. Simplify the artwork and try again.', loading: 'Loading designs…', notReady: 'The shop server has no designs table yet (run the 0009 migration).',
    preview: 'Preview', none: 'No designs yet.',
  },
  pt: {
    title: 'Designs', note: 'Adicione um design carregando o respetivo ficheiro de impressão (SVG). Aparece na loja e no configurador de imediato e o preço é calculado pelo servidor.',
    add: 'Adicionar design', builtin: 'Incluído', custom: 'Adicionado por si', visible: 'Visível', hidden: 'Oculto', hide: 'Ocultar', show: 'Mostrar', edit: 'Editar', del: 'Eliminar', reset: 'Repor original',
    confirmDel: (n: string) => `Eliminar "${n}" definitivamente? Deixa de aparecer na loja. As encomendas passadas mantêm os ficheiros.`, confirmReset: (n: string) => `Repor "${n}" para as definições originais?`,
    name: 'Nome', tagEn: 'Frase (inglês)', tagPt: 'Frase (português)', cat: 'Categoria', price: 'Preço por lado (€)', c1: 'Cor predefinida 1', c2: 'Cor predefinida 2',
    fixed: 'Cores fixas (imprime tal como desenhado, o cliente não pode mudar as cores)', file: 'Ficheiro de impressão (SVG, 746 × 285 mm + sangria)', fileKeep: 'Só escolha um ficheiro se quiser substituir o desenho.',
    checking: 'A verificar o ficheiro…', okFile: (r: boolean) => (r ? 'Ficheiro OK. Os clientes podem mudar as cores.' : 'Ficheiro OK. Não tem partes recoloríveis, por isso fica com cores fixas.'),
    save: 'Guardar', cancel: 'Cancelar', saving: 'A guardar…', saved: 'Guardado. A recarregar…', deleted: 'Feito. A recarregar…', failed: 'Não funcionou. Verifique os campos e tente de novo.',
    needFile: 'Escolha primeiro o ficheiro SVG.', needName: 'Dê um nome ao design.', bigPic: 'A imagem de pré-visualização é demasiado grande. Simplifique o desenho e tente de novo.', loading: 'A carregar designs…', notReady: 'O servidor da loja ainda não tem a tabela de designs (execute a migração 0009).',
    preview: 'Pré-visualização', none: 'Ainda não há designs.',
  },
};

interface Row { id: string; name: string | null; tag: string | null; tagPt: string | null; cat: string | null; price: number | null; c1: string | null; c2: string | null; fixed: boolean | null; hidden: boolean; custom: boolean; hasMaster: boolean }
interface Form { id: string; isNew: boolean; builtin: boolean; name: string; tag: string; tagPt: string; cat: string; price: string; c1: string; c2: string; fixed: boolean; hidden: boolean }

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
      return { id: b.id, name: r?.name ?? b.name, tag: r?.tag ?? b.tag, tagPt: r?.tagPt ?? null, cat: r?.cat ?? b.cat, price: r?.price ?? b.price, c1: r?.c1 ?? b.c1, c2: r?.c2 ?? b.c2, fixed: r?.fixed ?? !!b.fixed, hidden: !!r?.hidden, custom: false, hasMaster: true, changed: !!r } as Row & { changed: boolean };
    }),
    ...(rows || []).filter((r) => r.custom),
  ];

  const open = (r?: Row) => {
    setMaster(null); setFileMsg(null); setMsg('');
    if (!r) { setForm({ id: '', isNew: true, builtin: false, name: '', tag: '', tagPt: '', cat: CATS[0], price: '69', c1: 'flame', c2: 'crimson', fixed: false, hidden: false }); return; }
    setForm({ id: r.id, isNew: false, builtin: !r.custom, name: r.name || '', tag: r.tag || '', tagPt: r.tagPt || '', cat: r.cat || CATS[0], price: String(r.price ?? ''), c1: r.c1 || 'flame', c2: r.c2 || 'crimson', fixed: !!r.fixed, hidden: r.hidden });
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
          <div className="adm-bar">
            <button className="btn btn-primary" type="submit" disabled={busy}>{t.save}</button>
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => { setForm(null); setMaster(null); setFileMsg(null); setMsg(''); }}>{t.cancel}</button>
          </div>
        </form>
      )}
    </section>
  );
}

function uniqueId(base: string, all: { id: string }[]) {
  let id = base.length < 2 ? base + '-1' : base, n = 2;
  while (all.some((r) => r.id === id)) id = base.slice(0, 35) + '-' + n++;
  return id;
}
