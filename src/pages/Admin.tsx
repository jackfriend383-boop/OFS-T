/* Orders admin (/admin/): sign-in, order list with print-file ("mold") downloads, status New -> Printed -> Shipped.
   Every order row is UNTRUSTED (anyone can insert an order through the public API): kit configs go through sanitizeCfg,
   all text is rendered as text (React escapes it), statuses and ids are checked against allowlists, and totals are
   re-checked against the price list. Lazy-loaded: the 150 KB mold data is only fetched here. */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useApp } from '../state';
import { COPY } from '../content';
import { isUUID } from '../lib/backend';
import { fileBase, moldPNG, moldSVG, saveFile, svgBlob } from '../lib/mold';
import type { Cfg } from '../lib/kit';

type Panel = 'boot' | 'setup' | 'login' | 'locked' | 'main';
interface Order { id: string; ref: string; status: string; created: Date; name: string; email: string; street: string; postcode: string; city: string; country: string; items: { cfg: Cfg; qty: number; list: number }[]; dropped: number; total: number; listTotal: number; pers: boolean }
const NEXT: Record<string, string> = { new: 'printed', printed: 'shipped', shipped: 'new' };
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
const Rich = ({ html, as: Tag = 'span', ...p }: { html: string; as?: any } & Record<string, any>) => <Tag {...p} dangerouslySetInnerHTML={{ __html: html }} />; // our own copy, never user input

function Mold({ cfg, label, className }: { cfg: Cfg; label: string; className?: string }) {
  const { kit } = useApp();
  const html = useMemo(() => moldSVG(kit, cfg, { guide: true, label }), [kit, cfg, label]);
  return <div className={className || 'moldp'} dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function Admin() {
  const { kit, T, lang, backend, announce } = useApp();
  const c = COPY[lang].admin;
  const euro = (cents: number) => kit.money(Math.round(cents) / 100);
  const STATUS: Record<string, string> = { new: T('stNew'), printed: T('stPrinted'), shipped: T('stShipped') };
  const ACTION: Record<string, string> = { new: T('actNew'), printed: T('actPrinted'), shipped: T('actShipped') };
  const [panel, setPanel] = useState<Panel>('boot');
  const [orders, setOrders] = useState<Order[]>([]);
  const [msg, setMsgState] = useState('');
  const [who, setWho] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [testId, setTestId] = useState(kit.DESIGNS[0].id);
  const focusId = useRef<string | null>(null);

  const msgHidden = panel !== 'main';
  const say = useCallback((t: string) => { setMsgState(t); if (msgHidden) announce(t); }, [announce, msgHidden]);
  const focusLater = (id: string) => { focusId.current = id; };
  useEffect(() => { const id = focusId.current; if (!id) return; focusId.current = null; (document.getElementById(id) as HTMLElement | null)?.focus(); });

  function cleanOrder(o: any): Order | null {
    if (!o || typeof o !== 'object' || !isUUID(o.id)) return null;
    const cu = o.customer && typeof o.customer === 'object' ? o.customer : {};
    const raw = Array.isArray(o.items) ? o.items.slice(0, 50) : [];
    const items = raw.map((i: any) => {
      const cfg = i && typeof i === 'object' && kit.sanitizeCfg(i.cfg); if (!cfg) return null;
      return { cfg, qty: Math.min(99, Math.max(1, Math.floor(+i.qty) || 1)), list: Math.round(kit.priceOf(cfg) * 100) };
    }).filter(Boolean) as Order['items'];
    const total = Number.isFinite(+o.total_cents) ? Math.round(+o.total_cents) : 0;
    return {
      id: String(o.id), ref: String(o.id).slice(-6).toUpperCase(), status: STATUS[o.status] ? o.status : 'new', created: new Date(o.created_at),
      name: str(cu.name, 200), email: str(cu.email, 254), street: str(cu.street, 300), postcode: str(cu.postcode, 20), city: str(cu.city, 120), country: str(cu.country, 60),
      items, dropped: raw.length - items.length, total, listTotal: items.reduce((s, i) => s + i.list * i.qty, 0), pers: o.consent_personalised === true,
    };
  }

  const handleError = useCallback((e: any) => {
    if (e && e.code === 'session_expired') { setPanel('login'); setLoginErr(e.message); return; }
    say(e && e.message ? e.message : T('somethingWrong'));
  }, [say, T]);
  const loadOrders = useCallback(async () => {
    say(T('loadingOrders'));
    try { const rows = (await backend.listOrders()).map(cleanOrder).filter(Boolean) as Order[]; setOrders(rows); say(T.n('loaded', rows.length)); }
    catch (e) { handleError(e); }
  }, [backend]); // eslint-disable-line react-hooks/exhaustive-deps
  const enter = useCallback(async (focus: boolean) => {
    let s, admin;
    try { s = await backend.getSession(); if (!s) { setPanel('login'); if (focus) focusLater('admLoginTitle'); return; } admin = await backend.isAdmin(); }
    catch (e: any) { setPanel('login'); setLoginErr(e && e.message); return; } // expired session or server unreachable: back to the sign-in form with the reason
    if (!admin) { setPanel('locked'); return; }
    setPanel('main'); setWho(s.user.email ? T('signedInAs', { email: s.user.email }) : T('signedIn'));
    if (focus) focusLater('admListTitle');
    await loadOrders();
  }, [backend, loadOrders, T]);
  useEffect(() => { if (!backend.configured) setPanel('setup'); else enter(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget, email = f.elements.namedItem('email') as HTMLInputElement, pass = f.elements.namedItem('password') as HTMLInputElement;
    if (!email.value.trim() || !pass.value) { setLoginErr(T('enterCreds')); (email.value.trim() ? pass : email).focus(); return; }
    setBusy('login'); setLoginErr('');
    try { await backend.signIn(email.value, pass.value); pass.value = ''; await enter(true); }
    catch (ex: any) { setLoginErr(ex && ex.message ? ex.message : T('signInFailed')); pass.focus(); }
    finally { setBusy(null); }
  }
  async function signOut() {
    setBusy('out'); await backend.signOut(); setBusy(null); setOrders([]); setPanel('login'); setLoginErr(''); focusLater('admEmail'); announce(T('signedOut'));
  }
  const testCfgV = useMemo(() => kit.defaultCfg(kit.D(testId) || kit.DESIGNS[0]), [kit, testId]);
  const testCfg = () => testCfgV;
  async function download(cfg: Cfg, kind: 'png' | 'svg', tag: string, key: string) {
    setBusy(key);
    try {
      if (kind === 'svg') saveFile(fileBase(kit, cfg, tag) + '.svg', svgBlob(kit, cfg));
      else { say(T('preparing')); saveFile(fileBase(kit, cfg, tag) + '.png', await moldPNG(kit, cfg)); say(T('fileReady')); }
    } catch { say(T('fileFailed')); } finally { setBusy(null); }
  }
  async function advance(oi: number) {
    const o = orders[oi]; if (!o) return;
    setBusy('st' + oi);
    try {
      const row = await backend.setStatus(o.id, NEXT[o.status]);
      const status = STATUS[row.status] ? row.status : NEXT[o.status];
      setOrders((os) => os.map((x, i) => (i === oi ? { ...x, status } : x)));
      focusLater('adm-st-' + oi);
      say(T('markedAs', { ref: o.ref, status: STATUS[status].toLowerCase() }));
    } catch (ex) { handleError(ex); } finally { setBusy(null); }
  }

  const open = orders.filter((o) => o.status === 'new');
  const stats: [string, string | number][] = [[T('sOrders'), orders.length], [T('sToPrint'), open.length], [T('sSheets'), open.reduce((s, o) => s + o.items.reduce((t, i) => t + i.qty * (i.cfg.kit === 'both' ? 2 : 1), 0), 0)], [T('sRevenue'), euro(orders.reduce((s, o) => s + o.listTotal, 0))]];

  return (
    <section className="view adm" data-view="admin">
      <div className="page-head">
        <span className="eyebrow">{c.eyebrow}</span>
        <h1 className="display">{c.h1}</h1>
        <p className="muted adm-lead">{c.lead}</p>
      </div>
      <div className="section adm-body">
        {panel === 'boot' && <p className="adm-empty" id="admBoot">{c.loading}</p>}

        {panel === 'setup' && (
          <div className="adm-panel" id="admSetup">
            <h2 tabIndex={-1}>{c.setupTitle}</h2>
            <p>{c.setupIntro}</p>
            <ol className="adm-steps">{c.steps.map((s) => <Rich as="li" key={s} html={s} />)}</ol>
            <Rich as="p" className="adm-note" html={c.setupNote} />
          </div>
        )}

        {panel === 'login' && (
          <form className="adm-panel adm-login" id="admLogin" noValidate aria-labelledby="admLoginTitle" onSubmit={login}>
            <h2 id="admLoginTitle" tabIndex={-1}>{c.signIn}</h2>
            <div className="co-f"><label htmlFor="admEmail">{c.email}</label><input className="field" id="admEmail" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="off" spellCheck={false} required /></div>
            <div className="co-f"><label htmlFor="admPass">{c.password}</label><input className="field" id="admPass" name="password" type="password" autoComplete="current-password" required /></div>
            <p className="err" id="admLoginErr" role="alert">{loginErr}</p>
            <button className="btn btn-primary" type="submit" id="admLoginBtn" disabled={busy === 'login'} aria-busy={busy === 'login' || undefined}>{c.signIn}</button>
          </form>
        )}

        {panel === 'locked' && (
          <div className="adm-panel" id="admLocked">
            <h2 tabIndex={-1}>{c.lockedTitle}</h2>
            <Rich as="p" className="muted" html={c.lockedText} />
            <button className="btn btn-ghost" type="button" disabled={busy === 'out'} onClick={signOut}>{c.signOut}</button>
          </div>
        )}

        {panel === 'main' && (
          <div id="admMain">
            <h2 className="sr" id="admListTitle" tabIndex={-1}>{c.listTitle}</h2>
            <div className="adm-bar">
              <span className="adm-note" id="admWho">{who}</span>
              <button className="btn btn-ghost" type="button" id="admRefresh" onClick={loadOrders}>{c.refresh}</button>
              <button className="btn btn-ghost" type="button" disabled={busy === 'out'} onClick={signOut}>{c.signOut}</button>
            </div>
            <p className="adm-note" id="admMsg" role="status" aria-live="polite">{msg}</p>
            <div className="adm-stats" id="admStats">{stats.map(([k, v]) => <div key={k}><span className="eyebrow">{k}</span><b>{v}</b></div>)}</div>
            <div className="orders" id="admOrders">
              {!orders.length && <p className="adm-empty">{T('noOrders')}</p>}
              {orders.map((o, oi) => {
                const warn: string[] = [];
                if (o.total !== o.listTotal) warn.push(T('warnTotal', { sent: euro(o.total), list: euro(o.listTotal) }));
                if (o.dropped) warn.push(T.n('warnDropped', o.dropped));
                const when = isNaN(o.created.getTime()) ? '' : o.created.toLocaleString(T.locale);
                return (
                  <article className="order" key={o.id} aria-labelledby={'ord-' + oi}>
                    <div className="order-head">
                      <div>
                        <h3 id={'ord-' + oi}>{o.name || T('customer')} <span className="muted mono adm-ref">#{o.ref}</span></h3>
                        <p>{o.email}<br />{o.street}, {o.postcode} {o.city}, {o.country}<br />{when} · <span className="price">{euro(o.listTotal)}</span>{o.pers ? ' · ' + T('persAck') : ''}</p>
                        {warn.map((w) => <p className="err" key={w}>{w}</p>)}
                      </div>
                      <div className="adm-st">
                        <span className="status" data-s={o.status}>{STATUS[o.status]}</span>
                        <button className="btn btn-ghost" type="button" id={'adm-st-' + oi} disabled={busy === 'st' + oi} onClick={() => advance(oi)}>{ACTION[o.status]}<span className="sr">{T('orderSr', { ref: o.ref })}</span></button>
                      </div>
                    </div>
                    {o.items.map((it, ii) => {
                      const cf = it.cfg, n = it.qty * (cf.kit === 'both' ? 2 : 1), d = kit.D(cf.design)!, forOrder = T('forOrder', { name: d.name, ref: o.ref });
                      return (
                        <div className="oitem" key={ii}>
                          <Mold cfg={cf} label={T('moldPreview', { name: d.name })} />
                          <div>
                            <h4>{d.name} · {T.n('doorStickers', n)}</h4>
                            <p>{kit.descOf(cf)}<br />{T('qtyLine', { q: it.qty, price: euro(it.list * it.qty) })}
                              {cf.numberOn && cf.number && <><br />{T('badgeIn', { text: '\u0000', colour: kit.COLORS[cf.c1].name }).split('\u0000').map((p, k) => (k ? [<b key="b">{cf.number}</b>, p] : p))}</>}</p>
                            <div className="btns">
                              <button className="btn btn-primary" type="button" disabled={busy === `dl${oi}.${ii}`} onClick={() => download(cf, 'png', o.ref, `dl${oi}.${ii}`)}>{T('dlPng')}<span className="sr">{forOrder}</span></button>
                              <button className="btn btn-ghost" type="button" onClick={() => download(cf, 'svg', o.ref, `dl${oi}.${ii}`)}>{T('dlSvg')}<span className="sr">{forOrder}</span></button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </article>
                );
              })}
            </div>
          </div>
        )}

        <section className="adm-tool" aria-labelledby="admToolTitle">
          <h2 id="admToolTitle">{c.toolTitle}</h2>
          <p className="adm-note">{c.toolNote}</p>
          <div className="adm-bar">
            <label htmlFor="admDesign">{c.design}</label>
            <select className="field adm-select" id="admDesign" value={testId} onChange={(e) => setTestId(e.target.value)}>{kit.DESIGNS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            <button className="btn btn-primary" type="button" id="admTestPng" disabled={busy === 'tpng'} aria-busy={busy === 'tpng' || undefined} onClick={() => download(testCfg(), 'png', 'TEST', 'tpng')}>{c.png}</button>
            <button className="btn btn-ghost" type="button" id="admTestSvg" onClick={() => download(testCfg(), 'svg', 'TEST', 'tsvg')}>{c.svg}</button>
          </div>
          <Mold cfg={testCfgV} className="moldp adm-test-prev" label={T('moldPreview', { name: kit.D(testId)!.name })} />
        </section>
      </div>
    </section>
  );
}
