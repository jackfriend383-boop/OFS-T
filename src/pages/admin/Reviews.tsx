/* Admin "Reviews" tab: add, edit and remove the customer reviews shown on the home page (above "How it works") and in the configurator
   (below the order summary). Each review has a name, 0-5 stars, a comment and an optional photo (shrunk in the browser to 480 px).
   The shop's server (worker/src/reviews.ts) checks every field again. */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useApp } from '../../state';
import { cleanReviews, shrinkPhoto, MAX_PHOTO_FILE, type Review } from '../../lib/reviews';
import { Stars } from '../../components/Reviews';

const TXT = {
  en: {
    title: 'Customer reviews', note: 'Reviews appear on the home page above "How it works" and in the configurator below the order summary, newest first. Up to 40.',
    add: 'Add a review', edit: 'Edit review', name: 'Name', rating: 'Stars (0 to 5)', comment: 'Comment', photo: 'Photo (optional)', choose: 'Choose a photo', removePhoto: 'Remove photo',
    save: 'Save review', saveNew: 'Add review', saving: 'Saving…', saved: 'Saved.', cancel: 'Cancel', del: 'Delete', editBtn: 'Edit', confirmDel: 'Delete this review? This cannot be undone.',
    empty: 'No reviews yet. Add the first one above.', loading: 'Loading reviews…', stars: (n: number) => `${n} out of 5 stars`, left: (n: number) => `${n} characters left`,
    failed: 'That did not work. Check the fields and try again.', needDeploy: 'The shop server does not have the reviews feature yet (run the 0012 migration and deploy the Worker).',
    badPhoto: 'Use a JPG, PNG or WebP picture under 8 MB.', tooMany: 'You already have 40 reviews. Delete one first.', deleted: 'Deleted.',
  },
  pt: {
    title: 'Opiniões de clientes', note: 'As opiniões aparecem na página inicial acima de "Como funciona" e no configurador abaixo do resumo da encomenda, as mais recentes primeiro. Até 40.',
    add: 'Adicionar opinião', edit: 'Editar opinião', name: 'Nome', rating: 'Estrelas (0 a 5)', comment: 'Comentário', photo: 'Foto (opcional)', choose: 'Escolher foto', removePhoto: 'Remover foto',
    save: 'Guardar opinião', saveNew: 'Adicionar opinião', saving: 'A guardar…', saved: 'Guardado.', cancel: 'Cancelar', del: 'Apagar', editBtn: 'Editar', confirmDel: 'Apagar esta opinião? Não pode ser desfeito.',
    empty: 'Ainda não há opiniões. Adiciona a primeira acima.', loading: 'A carregar opiniões…', stars: (n: number) => `${n} em 5 estrelas`, left: (n: number) => `${n} caracteres restantes`,
    failed: 'Não funcionou. Verifica os campos e tenta de novo.', needDeploy: 'O servidor da loja ainda não tem as opiniões (executa a migração 0012 e faz o deploy do Worker).',
    badPhoto: 'Usa uma imagem JPG, PNG ou WebP com menos de 8 MB.', tooMany: 'Já tens 40 opiniões. Apaga uma primeiro.', deleted: 'Apagada.',
  },
};

interface Draft { id: number | null; name: string; rating: number; comment: string; photo: string }
const EMPTY: Draft = { id: null, name: '', rating: 5, comment: '', photo: '' };

export default function Reviews() {
  const { backend, lang } = useApp();
  const t = TXT[lang === 'pt' ? 'pt' : 'en'];
  const [list, setList] = useState<Review[] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setList(cleanReviews(await backend.listReviews())); }
    // The shop's server answers "invalid" (a 404) for a route it does not have yet: the Worker was not updated / migrated.
    catch (e: any) { setList([]); setMsg(e && (e.code === 'invalid' || e.code === 'server') ? t.needDeploy : e && e.message ? e.message : t.failed); }
  }, [backend, t.needDeploy, t.failed]);
  useEffect(() => { void load(); }, [load]);

  const errMsg = (e: any) => (e && e.code === 'session_expired' && e.message ? e.message : e && e.code === 'server' ? t.needDeploy : t.failed);

  async function pick(f: File | undefined) {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > MAX_PHOTO_FILE) { setMsg(t.badPhoto); return; }
    try { const url = await shrinkPhoto(f); setDraft((d) => ({ ...d, photo: url })); setMsg(''); }
    catch { setMsg(t.badPhoto); }
    if (file.current) file.current.value = '';
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const name = draft.name.trim(), comment = draft.comment.trim();
    if (!name || !comment) { setMsg(t.failed); return; }
    setBusy(true); setMsg(t.saving);
    try {
      if (draft.id === null) await backend.addReview({ name, rating: draft.rating, comment, ...(draft.photo ? { photo: draft.photo } : {}) });
      else await backend.saveReview(draft.id, { name, rating: draft.rating, comment, photo: draft.photo || null });
      setDraft(EMPTY); setMsg(t.saved); await load();
    } catch (err: any) { setMsg(errMsg(err)); }
    setBusy(false);
  }

  async function remove(r: Review) {
    if (busy || !confirm(t.confirmDel)) return;
    setBusy(true);
    try { await backend.deleteReview(r.id); if (draft.id === r.id) setDraft(EMPTY); setMsg(t.deleted); await load(); }
    catch (err: any) { setMsg(errMsg(err)); }
    setBusy(false);
  }

  return (
    <section className="adm-tool adm-reviews" aria-labelledby="admReviewsTitle">
      <h2 id="admReviewsTitle">{t.title}</h2>
      <p className="adm-note">{t.note}</p>

      <form className="adm-panel rv-form" onSubmit={submit} noValidate>
        <h3>{draft.id === null ? t.add : t.edit}</h3>
        <div className="co-f">
          <label htmlFor="rvName">{t.name}</label>
          <input className="field" id="rvName" maxLength={60} autoComplete="off" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div className="co-f">
          <span id="rvRatingL">{t.rating}</span>
          <div className="rv-pick" role="radiogroup" aria-labelledby="rvRatingL">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={draft.rating === n} className={'rv-n' + (draft.rating === n ? ' on' : '')} onClick={() => setDraft({ ...draft, rating: n })}>{n}</button>
            ))}
            <Stars value={draft.rating} label={t.stars(draft.rating)} />
          </div>
        </div>
        <div className="co-f">
          <label htmlFor="rvComment">{t.comment}</label>
          <textarea className="field" id="rvComment" rows={4} maxLength={600} value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} />
          <span className="adm-note">{t.left(600 - draft.comment.length)}</span>
        </div>
        <div className="co-f">
          <span>{t.photo}</span>
          <div className="rv-photo-row">
            {draft.photo && <img className="rv-photo" src={draft.photo} alt="" />}
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void pick(e.target.files?.[0])} />
            <button className="btn btn-ghost" type="button" onClick={() => file.current?.click()}>{t.choose}</button>
            {draft.photo && <button className="btn btn-ghost" type="button" onClick={() => setDraft({ ...draft, photo: '' })}>{t.removePhoto}</button>}
          </div>
        </div>
        <div className="adm-bar">
          <button className="btn btn-primary" type="submit" disabled={busy}>{draft.id === null ? t.saveNew : t.save}</button>
          {draft.id !== null && <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => { setDraft(EMPTY); setMsg(''); }}>{t.cancel}</button>}
        </div>
      </form>
      <p className="adm-note" role="status" aria-live="polite">{msg}</p>

      {!list && <p className="adm-empty">{t.loading}</p>}
      {list && !list.length && <p className="adm-empty">{t.empty}</p>}
      {list && list.length > 0 && (
        <ul className="rv-admin">
          {list.map((r) => (
            <li className="rv-row" key={r.id}>
              {r.photo ? <img className="rv-photo" src={r.photo} alt="" /> : <span className="rv-photo rv-none" aria-hidden="true" />}
              <div className="rv-row-body">
                <b>{r.name}</b> <Stars value={r.rating} label={t.stars(r.rating)} />
                <p>{r.comment}</p>
              </div>
              <div className="rv-row-act">
                <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => { setDraft({ id: r.id, name: r.name, rating: r.rating, comment: r.comment, photo: r.photo }); setMsg(''); scrollTo({ top: 0, behavior: 'smooth' }); }}>{t.editBtn}</button>
                <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void remove(r)}>{t.del}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
