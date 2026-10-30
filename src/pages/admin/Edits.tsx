/* Admin "Edits" tab: a list of cards, one per part of the public site the owner can change without code. More cards can be added
   to FEATURES below. First card: background pictures (home page + configurator, light + dark theme): upload, fit / zoom / focal
   point, live preview that uses the same CSS rule as the site (bgCss), save, reset. The Worker checks everything again
   (worker/src/settings.ts); the picture is shrunk here first (siteSettings.ts, shrinkImage). */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../../state';
import { EDITS } from './copy';
import { MAX_FILE_BYTES, SLOTS, SettingsApiError, bgCss, settingsApi, shrinkImage, type Fit, type SlotData, type SlotId, type SlotMap } from '../../lib/siteSettings';

type Copy = typeof EDITS.en;
type Say = (text: string) => void;

/* What the site shows when a slot has no custom picture (see site.css): picture + the default focal point. */
const DEFAULTS: Record<SlotId, { img: string; x: number; y: number }> = {
  homeLight: { img: '/assets/img/beach.svg', x: 50, y: 100 },
  homeDark: { img: '/assets/img/city-night.svg', x: 50, y: 100 },
  confLight: { img: '/assets/img/beach.svg', x: 50, y: 78 },
  confDark: { img: '/assets/img/city-night.svg', x: 50, y: 78 },
};
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
interface Draft { fit: Fit; zoom: number; x: number; y: number }
const fromServer = (id: SlotId, s?: SlotData): Draft => (s ? { fit: (s.fit as Fit) || 'cover', zoom: s.zoom || 100, x: s.x ?? 50, y: s.y ?? 50 } : { fit: 'cover', zoom: 100, x: DEFAULTS[id].x, y: DEFAULTS[id].y });

function SlotCard({ id, server, c, say, getToken, onChanged, onExpired }: { id: SlotId; server?: SlotData; c: Copy; say: Say; getToken: () => Promise<string>; onChanged: () => Promise<void>; onExpired: () => void }) {
  const label = c.slots[id];
  const [draft, setDraft] = useState<Draft>(() => fromServer(id, server));
  const [pending, setPending] = useState<{ blob: Blob; url: string } | null>(null);
  const [remote, setRemote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'' | 'file' | 'save' | 'reset'>('');
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-sync the controls when the server's copy changes (after a save or reset).
  useEffect(() => { setDraft(fromServer(id, server)); setDirty(false); }, [id, server?.ver, !!server]); // eslint-disable-line react-hooks/exhaustive-deps
  // The picture currently saved on the server, as a blob: address (the admin page's CSP only allows images from itself, data: and blob:).
  useEffect(() => {
    if (!server) { setRemote(''); return; }
    let live = true, made = '';
    settingsApi.blobOf(server.url).then((u) => { made = u; if (live) setRemote(u); else URL.revokeObjectURL(u); }).catch(() => { if (live) setRemote(''); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [server?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (pending) URL.revokeObjectURL(pending.url); }, [pending]);

  const custom = !!pending || !!server;
  const img = pending ? pending.url : server ? remote : DEFAULTS[id].img;
  const css = custom ? bgCss(draft.fit, draft.zoom, draft.x, draft.y) : bgCss('cover', 100, DEFAULTS[id].x, DEFAULTS[id].y);
  const set = (p: Partial<Draft>) => { setDraft((d) => ({ ...d, ...p })); setDirty(true); setNote(''); };

  const fail = (e: unknown) => {
    if (e instanceof SettingsApiError && e.code === 'session_expired') { onExpired(); return; }
    const m = c.failed; setNote(m); say(m);
  };

  async function choose(file: File | undefined) {
    if (!file) return;
    if (!TYPES.includes(file.type)) { setNote(c.badType); say(c.badType); return; }
    if (file.size > MAX_FILE_BYTES) { setNote(c.tooBig); say(c.tooBig); return; }
    setBusy('file'); setNote(c.loading);
    try {
      const blob = await shrinkImage(file);
      setPending({ blob, url: URL.createObjectURL(blob) }); setDirty(true); setNote(c.unsaved); say(c.unsaved);
    } catch (e: any) {
      const m = e && e.message === 'too_big' ? c.tooBigAfter : c.unreadable; setNote(m); say(m);
    } finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function save() {
    if (!custom) { setNote(c.needImage); say(c.needImage); return; }
    setBusy('save'); setNote(c.saving);
    try {
      const token = await getToken();
      if (pending) await settingsApi.putImage(token, id, pending.blob);
      await settingsApi.putSettings(token, id, { fit: draft.fit, zoom: draft.zoom, posX: draft.x, posY: draft.y });
      setPending(null); await onChanged();
      const m = c.saved(label); setNote(m); say(m);
    } catch (e) { fail(e); } finally { setBusy(''); }
  }

  async function reset() {
    if (!window.confirm(c.confirmReset(label))) return;
    setBusy('reset');
    try {
      if (server) await settingsApi.reset(await getToken(), id);
      setPending(null); setDirty(false); await onChanged();
      const m = c.resetDone(label); setNote(m); say(m);
    } catch (e) { fail(e); } finally { setBusy(''); }
  }

  const fid = 'edit-' + id;
  const zoomOff = draft.fit !== 'cover';
  const state = busy === 'save' ? c.saving : dirty ? c.unsaved : server ? c.savedState : c.defaultPic;
  return (
    <article className="edit-slot" aria-labelledby={fid + '-h'}>
      <header className="edit-slot-head">
        <h4 id={fid + '-h'}>{label}</h4>
        <span className={'edit-state' + (dirty ? ' is-dirty' : server ? ' is-saved' : '')}>{state}</span>
      </header>
      <div className="edit-preview" role="img" aria-label={c.previewOf(label)} style={{ backgroundImage: img ? `url("${img}")` : undefined, backgroundSize: css.size, backgroundPosition: css.pos }} data-custom={custom ? '1' : '0'}>
        <span className="edit-badge">{custom ? c.custom : c.defaultPic}</span>
      </div>
      <div className="edit-actions">
        <input ref={fileRef} className="sr" id={fid + '-file'} type="file" accept="image/png,image/jpeg,image/webp" tabIndex={-1} onChange={(e) => void choose(e.currentTarget.files?.[0])} />
        <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => fileRef.current?.click()}>{c.upload}</button>
        <button type="button" className="btn btn-ghost" disabled={!!busy || !custom} onClick={() => void reset()}>{c.reset}</button>
      </div>
      <p className="adm-note edit-hint">{c.fileHint}</p>
      <fieldset className="edit-fit" disabled={!custom || !!busy}>
        <legend>{c.fit}</legend>
        <div className="edit-seg" role="radiogroup" aria-label={c.fit}>
          {(['cover', 'contain', 'stretch'] as Fit[]).map((f) => (
            <label key={f} className={draft.fit === f ? 'is-on' : ''}>
              <input type="radio" name={fid + '-fit'} value={f} checked={draft.fit === f} onChange={() => set({ fit: f })} />
              <span>{c.fits[f]}</span>
            </label>
          ))}
        </div>
        <p className="adm-note">{c.fitHelp[draft.fit]}</p>
        <div className="edit-range">
          <label htmlFor={fid + '-zoom'}>{c.zoom}</label>
          <input id={fid + '-zoom'} type="range" min={100} max={250} step={5} value={draft.zoom} disabled={zoomOff} onChange={(e) => set({ zoom: +e.currentTarget.value })} aria-describedby={zoomOff ? fid + '-zh' : undefined} />
          <output htmlFor={fid + '-zoom'}>{draft.zoom}%</output>
        </div>
        {zoomOff && <p className="adm-note" id={fid + '-zh'}>{c.zoomOnly}</p>}
        <div className="edit-range">
          <label htmlFor={fid + '-x'}>{c.posX}</label>
          <input id={fid + '-x'} type="range" min={0} max={100} step={1} value={draft.x} onChange={(e) => set({ x: +e.currentTarget.value })} />
          <output htmlFor={fid + '-x'}>{draft.x}%</output>
        </div>
        <div className="edit-range">
          <label htmlFor={fid + '-y'}>{c.posY}</label>
          <input id={fid + '-y'} type="range" min={0} max={100} step={1} value={draft.y} onChange={(e) => set({ y: +e.currentTarget.value })} />
          <output htmlFor={fid + '-y'}>{draft.y}%</output>
        </div>
      </fieldset>
      <div className="edit-actions">
        <button type="button" className="btn btn-primary" disabled={!!busy || !custom || (!dirty && !pending)} onClick={() => void save()}>{busy === 'save' ? c.saving : c.save}</button>
        <span className="edit-note" aria-live="polite">{note}</span>
      </div>
    </article>
  );
}

function BackgroundCard({ c, say, getToken, onExpired }: { c: Copy; say: Say; getToken: () => Promise<string>; onExpired: () => void }) {
  const [slots, setSlots] = useState<SlotMap | null>(null);
  const [err, setErr] = useState(false);
  const load = useCallback(async () => { try { setSlots(await settingsApi.list()); setErr(false); } catch { setSlots({}); setErr(true); } }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <section className="dpanel dpanel-wide edit-card" aria-labelledby="editBgTitle">
      <header><h3 id="editBgTitle">{c.bgTitle}</h3><p className="adm-note">{c.bgNote}</p></header>
      {err && <p className="adm-empty" role="alert">{c.notReady}</p>}
      {!slots ? <p className="adm-empty">{c.loading}</p> : (
        <div className="edit-grid">
          {SLOTS.map((id) => <SlotCard key={id} id={id} server={slots[id]} c={c} say={say} getToken={getToken} onChanged={load} onExpired={onExpired} />)}
        </div>
      )}
    </section>
  );
}

export default function Edits({ onExpired }: { onExpired: () => void }) {
  const { backend, lang, announce } = useApp();
  const c = EDITS[lang === 'pt' ? 'pt' : 'en'];
  const getToken = useCallback(async () => {
    const s = await backend.getSession();
    if (!s) throw new SettingsApiError('session_expired', 401);
    return s.access_token as string;
  }, [backend]);
  // The feature cards: add new "edit the site" features here.
  const FEATURES = useMemo<{ id: string; node: ReactNode }[]>(() => [
    { id: 'backgrounds', node: <BackgroundCard c={c} say={announce} getToken={getToken} onExpired={onExpired} /> },
  ], [c, announce, getToken, onExpired]);
  return (
    <div className="edits">
      <p className="adm-note edits-intro">{c.intro}</p>
      {FEATURES.map((f) => <div key={f.id}>{f.node}</div>)}
    </div>
  );
}
