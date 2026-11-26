/* Admin "Waiting list" tab: the emails people left on the site (outside the São Miguel pre-sale), newest first, with a count per area,
   "copy all emails" and a CSV download, and a delete button per row. Every value is text from the public (anyone can sign up), so it is
   only ever rendered as text, and the CSV guards against spreadsheet formulas. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../state';

interface Entry { id: number; email: string; area: string; lang: string; date: string }

const TXT = {
  en: {
    title: 'Waiting list', note: 'People who do not live in São Miguel and asked to be told when you deliver to their area.', total: 'Total', copy: 'Copy all emails', copied: 'Copied.', csv: 'Download CSV',
    email: 'Email', area: 'Area', date: 'Date', del: 'Delete', confirmDel: 'Remove this email from the list?', empty: 'Nobody has signed up yet.', loading: 'Loading the list…',
    failed: 'Could not load the list.', needDeploy: 'The shop server does not have the waiting list yet (run the 0013 migration and deploy the Worker).',
    areas: { mainland: 'Portugal mainland', madeira: 'Madeira', azores: 'Other Azores island', other: 'Other country' } as Record<string, string>,
  },
  pt: {
    title: 'Lista de espera', note: 'Pessoas que não vivem em São Miguel e pediram para ser avisadas quando entregares na zona delas.', total: 'Total', copy: 'Copiar todos os emails', copied: 'Copiado.', csv: 'Descarregar CSV',
    email: 'Email', area: 'Zona', date: 'Data', del: 'Apagar', confirmDel: 'Remover este email da lista?', empty: 'Ainda ninguém se inscreveu.', loading: 'A carregar a lista…',
    failed: 'Não foi possível carregar a lista.', needDeploy: 'O servidor da loja ainda não tem a lista de espera (executa a migração 0013 e faz o deploy do Worker).',
    areas: { mainland: 'Portugal continental', madeira: 'Madeira', azores: 'Outra ilha dos Açores', other: 'Outro país' } as Record<string, string>,
  },
};

const clean = (raw: any): Entry[] => (raw && Array.isArray(raw.entries) ? raw.entries : [])
  .filter((e: any) => e && Number.isInteger(e.id) && typeof e.email === 'string')
  .map((e: any) => ({ id: e.id, email: String(e.email).slice(0, 254), area: String(e.area || 'other'), lang: String(e.lang || 'pt'), date: String(e.date || '') }));
const cell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? "'" + v : v).replace(/"/g, '""')}"`;

export default function Waitlist() {
  const { backend, lang } = useApp();
  const t = TXT[lang === 'pt' ? 'pt' : 'en'];
  const [list, setList] = useState<Entry[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setList(clean(await backend.listWaitlist())); setMsg(''); }
    catch (e: any) { setList([]); setMsg(e && (e.code === 'invalid' || e.code === 'server') ? t.needDeploy : t.failed); }
  }, [backend, t.needDeploy, t.failed]);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => { const m: Record<string, number> = {}; (list || []).forEach((e) => { m[e.area] = (m[e.area] || 0) + 1; }); return m; }, [list]);

  async function copyAll() {
    try { await navigator.clipboard.writeText((list || []).map((e) => e.email).join('\n')); setMsg(t.copied); } catch { setMsg(t.failed); }
  }
  function downloadCsv() {
    const rows = [['email', 'area', 'lang', 'date'], ...(list || []).map((e) => [e.email, e.area, e.lang, e.date])];
    const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'ofst-waitlist.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function remove(e: Entry) {
    if (busy || !confirm(t.confirmDel)) return;
    setBusy(true);
    try { await backend.deleteWaitlist(e.id); await load(); } catch { setMsg(t.failed); }
    setBusy(false);
  }

  return (
    <section className="adm-tool adm-waitlist" aria-labelledby="admWaitTitle">
      <h2 id="admWaitTitle">{t.title}</h2>
      <p className="adm-note">{t.note}</p>
      {!list && <p className="adm-empty">{t.loading}</p>}
      {list && (
        <>
          <p className="adm-note"><b>{t.total}: {list.length}</b>{Object.keys(counts).map((k) => <span key={k}> · {t.areas[k] || k}: {counts[k]}</span>)}</p>
          <div className="adm-bar">
            <button className="btn btn-ghost" type="button" disabled={!list.length} onClick={() => void copyAll()}>{t.copy}</button>
            <button className="btn btn-ghost" type="button" disabled={!list.length} onClick={downloadCsv}>{t.csv}</button>
          </div>
        </>
      )}
      <p className="adm-note" role="status" aria-live="polite">{msg}</p>
      {list && !list.length && !msg && <p className="adm-empty">{t.empty}</p>}
      {list && list.length > 0 && (
        <ul className="rv-admin">
          {list.map((e) => (
            <li className="rv-row" key={e.id}>
              <div className="rv-row-body"><b>{e.email}</b><p>{t.areas[e.area] || e.area} · {e.date.slice(0, 10)}</p></div>
              <div className="rv-row-act"><button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void remove(e)}>{t.del}</button></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
