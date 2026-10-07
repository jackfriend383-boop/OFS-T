/* Owner dashboard (admin.ofstdesigns.com): sign-in, then tabs for an overview (KPIs + revenue trend), sales reports,
   the order list (search / filter / sort, CSV export, print-file ("mold") downloads, status New -> Printed -> Shipped),
   customers and the print-file test tool. Analytics are computed in the browser from the loaded orders (admin/stats.ts).
   Every order row is UNTRUSTED (anyone can insert an order through the public API): kit configs go through sanitizeCfg,
   all text is rendered as text (React escapes it), statuses and ids are checked against allowlists, and totals are
   re-checked against the price list. Lazy-loaded: the 150 KB mold data is only fetched here. */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useApp } from '../state';
import { COPY } from '../content';
import { isUUID } from '../lib/backend';
import { fileBase, moldPNG, moldSVG, saveFile, svgBlob } from '../lib/mold';
import type { Cfg } from '../lib/kit';
import { DASH } from './admin/copy';
import { RANGES, customers as groupCustomers, dayKey, delta, inRange, kpis, rangeBounds, reports, series, sheetsOf, toCSV, type CustomerRow, type Point, type RangeKey } from './admin/stats';
import { BarList, Columns, TrendChart } from './admin/Charts';

type Panel = 'boot' | 'setup' | 'login' | 'locked' | 'main';
type Tab = 'overview' | 'reports' | 'orders' | 'customers' | 'tools';
const TABS: Tab[] = ['overview', 'reports', 'orders', 'customers', 'tools'];
const TAB_KEY = 'ofst-admin-tab', RANGE_KEY = 'ofst-admin-range';
const remember = (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } };
const recall = (k: string) => { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } };
const pct = (v: number, locale: string) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(v);
interface Order { id: string; ref: string; status: string; created: Date; name: string; email: string; street: string; postcode: string; city: string; country: string; items: { cfg: Cfg; qty: number; list: number }[]; dropped: number; total: number; listTotal: number; pers: boolean; pay: string }
const NEXT: Record<string, string> = { new: 'printed', printed: 'shipped', shipped: 'new' };
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
const Rich = ({ html, as: Tag = 'span', ...p }: { html: string; as?: any } & Record<string, any>) => <Tag {...p} dangerouslySetInnerHTML={{ __html: html }} />; // our own copy, never user input

function Mold({ cfg, label, className }: { cfg: Cfg; label: string; className?: string }) {
  const { kit } = useApp();
  const html = useMemo(() => moldSVG(kit, cfg, { guide: true, label }), [kit, cfg, label]);
  return <div className={className || 'moldp'} dangerouslySetInnerHTML={{ __html: html }} />;
}

/* Presentational pieces, defined once at module level so they keep their state across re-renders. */
interface KpiProps { label: string; value: string | number; now?: number; before?: number; hint?: string; invert?: boolean; accent?: boolean; vsPrev: string; locale: string }
function KpiView({ label, value, now, before, hint, invert, accent, vsPrev, locale }: KpiProps) {
  const v = now === undefined ? null : delta(now, before), up = v !== null && v > 0, good = invert ? !up : up;
  return (
    <div className={'kpi' + (accent ? ' kpi-accent' : '')}>
      <span className="eyebrow">{label}</span>
      <b>{value}</b>
      <span className="kpi-foot">
        {v !== null && <span className={'kpi-d ' + (v === 0 ? '' : good ? 'up' : 'down')} title={vsPrev}>{v === 0 ? '±0%' : (up ? '▲ ' : '▼ ') + pct(Math.abs(v), locale)}<span className="sr"> {vsPrev}</span></span>}
        {hint && <span className="kpi-hint">{hint}</span>}
      </span>
    </div>
  );
}
function Card({ title, note, children, wide }: { title: string; note?: string; children: ReactNode; wide?: boolean }) {
  return <section className={'dcard' + (wide ? ' dcard-wide' : '')}><header><h3>{title}</h3>{note && <p className="adm-note">{note}</p>}</header>{children}</section>;
}

export default function Admin() {
  const { kit, T, lang, backend, announce } = useApp();
  const c = COPY[lang].admin;
  const euro = (cents: number) => kit.money(Math.round(cents) / 100);
  const euro0 = (cents: number) => kit.money(Math.round(cents / 100));
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
      pay: o.payment_status === 'paid' ? 'paid' : o.payment_status === 'mismatch' ? 'mismatch' : 'unpaid', // set only by Stripe's signed webhook
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
  async function advance(id: string) {
    const o = orders.find((x) => x.id === id); if (!o) return;
    setBusy('st' + id);
    try {
      const row = await backend.setStatus(o.id, NEXT[o.status]);
      const status = STATUS[row.status] ? row.status : NEXT[o.status];
      setOrders((os) => os.map((x) => (x.id === id ? { ...x, status } : x)));
      focusLater('adm-st-' + o.ref);
      say(T('markedAs', { ref: o.ref, status: STATUS[status].toLowerCase() }));
    } catch (ex) { handleError(ex); } finally { setBusy(null); }
  }

  /* ---------- Dashboard state ---------- */
  const d = DASH[lang];
  const [tab, setTabState] = useState<Tab>(() => (TABS as string[]).includes(recall(TAB_KEY)) ? recall(TAB_KEY) as Tab : 'overview');
  const [range, setRangeState] = useState<RangeKey>(() => (RANGES as string[]).includes(recall(RANGE_KEY)) ? recall(RANGE_KEY) as RangeKey : '30');
  const [metric, setMetric] = useState<'revenue' | 'orders'>('revenue');
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('all');
  const [fPay, setFPay] = useState('all');
  const [sort, setSort] = useState<'new' | 'old' | 'high' | 'low'>('new');
  const [limit, setLimit] = useState(20);
  const [cSort, setCSort] = useState<'spent' | 'orders' | 'last'>('spent');
  const setTab = (t: Tab) => { setTabState(t); remember(TAB_KEY, t); };
  const setRange = (r: RangeKey) => { setRangeState(r); remember(RANGE_KEY, r); };
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  function tabKeys(e: KeyboardEvent, i: number) {
    const n = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!n && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next = TABS[e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + n + TABS.length) % TABS.length];
    setTab(next); tabRefs.current[next]?.focus();
  }

  const locale = T.locale as string;
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const euroShort = useCallback((cents: number) => {
    const v = cents / 100;
    return v >= 1000 ? new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(v) : kit.money(Math.round(v));
  }, [locale, kit]);
  const fmtDay = useCallback((dt: Date, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => dt.toLocaleDateString(locale, opts), [locale]);

  const bounds = useMemo(() => rangeBounds(range, orders), [range, orders]);
  const cur = useMemo(() => inRange(orders, bounds.from, bounds.to), [orders, bounds]);
  const prev = useMemo(() => (bounds.prevFrom && bounds.prevTo ? inRange(orders, bounds.prevFrom, bounds.prevTo) : null), [orders, bounds]);
  const K = useMemo(() => kpis(cur), [cur]);
  const KP = useMemo(() => (prev ? kpis(prev) : null), [prev]);
  const allOpen = useMemo(() => orders.filter((o) => o.status === 'new'), [orders]);
  const pts = useMemo(() => series(cur, bounds.from, bounds.to, range === 'today'), [cur, bounds, range]);
  const rep = useMemo(() => reports(kit, cur, T), [kit, cur, T]);
  const custs = useMemo(() => groupCustomers(cur), [cur]);
  const custAll = useMemo(() => groupCustomers(orders), [orders]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^#/, '');
    const list = orders.filter((o) => (fStatus === 'all' || o.status === fStatus) && (fPay === 'all' || o.pay === fPay) &&
      (!needle || [o.name, o.email, o.ref, o.city, o.country, o.postcode].some((s) => s.toLowerCase().includes(needle))));
    const t = (o: Order) => o.created.getTime() || 0;
    return list.sort((a, b) => sort === 'old' ? t(a) - t(b) : sort === 'high' ? b.total - a.total : sort === 'low' ? a.total - b.total : t(b) - t(a));
  }, [orders, q, fStatus, fPay, sort]);
  useEffect(() => { setLimit(20); }, [q, fStatus, fPay, sort]);

  function exportCSV() {
    const rows: (string | number)[][] = [d.csvHead];
    shown.forEach((o) => rows.push([
      '#' + o.ref, isNaN(o.created.getTime()) ? '' : o.created.toISOString(), STATUS[o.status], o.pay === 'paid' ? d.paid : d.mismatch,
      o.name, o.email, o.street, o.postcode, o.city, o.country,
      o.items.map((i) => `${i.qty}x ${kit.D(i.cfg.design)?.name || i.cfg.design} (${kit.descOf(i.cfg)})`).join(' | '),
      o.items.reduce((s, i) => s + sheetsOf(i), 0), (o.total / 100).toFixed(2),
    ]));
    saveFile(`ofst-orders-${dayKey(new Date())}.csv`, new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }));
  }
  async function bulk(kind: 'png' | 'svg') {
    const jobs = allOpen.flatMap((o) => o.items.map((it) => ({ cfg: it.cfg, ref: o.ref })));
    if (!jobs.length) { say(d.bulkNone); return; }
    setBusy('bulk');
    try {
      for (let i = 0; i < jobs.length; i++) {
        say(d.bulkProgress(i + 1, jobs.length));
        const j = jobs[i], name = fileBase(kit, j.cfg, j.ref) + (jobs.length > 1 ? `-${i + 1}` : '');
        if (kind === 'svg') saveFile(name + '.svg', svgBlob(kit, j.cfg)); else saveFile(name + '.png', await moldPNG(kit, j.cfg));
        await new Promise((r) => setTimeout(r, 350)); // browsers drop downloads fired in the same instant
      }
      say(d.bulkDone(jobs.length));
    } catch { say(T('fileFailed')); } finally { setBusy(null); }
  }

  /* ---------- Pieces ---------- */
  const rangeBar = (
    <div className="seg" role="group" aria-label={d.range}>
      {RANGES.map((r) => <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>{d.ranges[r]}</button>)}
    </div>
  );
  const kp = { vsPrev: d.vsPrev, locale };
  const xLabel = (p: Point) => (range === 'today' ? `${p.key}h` : fmtDay(p.date));
  const tip = (p: Point) => (
    <><b>{range === 'today' ? `${p.key}:00` : fmtDay(p.date, { weekday: 'short', day: 'numeric', month: 'short' })}</b><span>{euro(p.revenue)}</span><span>{d.ordersN(p.orders)}</span></>
  );

  const ordersList = (list: Order[], compact: boolean) => list.map((o) => {
    const warn: string[] = [];
    if (o.total !== o.listTotal) warn.push(T('warnTotal', { sent: euro(o.total), list: euro(o.listTotal) }));
    if (o.dropped) warn.push(T.n('warnDropped', o.dropped));
    if (o.pay === 'mismatch') warn.push(T('warnMismatch'));
    const when = isNaN(o.created.getTime()) ? '' : o.created.toLocaleString(locale);
    const kits = o.items.reduce((s, i) => s + i.qty, 0);
    return (
      <article className={'order' + (compact ? ' order-compact' : '')} key={o.id} aria-labelledby={'ord-' + o.ref}>
        <div className="order-head">
          <div>
            <h3 id={'ord-' + o.ref}>{o.name || T('customer')} <span className="muted mono adm-ref">#{o.ref}</span></h3>
            {compact
              ? <p>{when} · {d.kits(kits)} · <span className="price">{euro(o.total)}</span>{o.city ? ' · ' + o.city : ''}</p>
              : <p>{o.email}<br />{o.street}, {o.postcode} {o.city}, {o.country}<br />{when} · <span className="price">{euro(o.listTotal)}</span>{o.pay === 'paid' ? ' · ' + T('payPaid') : ''}{o.pers ? ' · ' + T('persAck') : ''}</p>}
            {warn.map((w) => <p className="err" key={w}>{w}</p>)}
          </div>
          <div className="adm-st">
            <span className="status" data-s={o.status}>{STATUS[o.status]}</span>
            <button className="btn btn-ghost" type="button" id={compact ? undefined : 'adm-st-' + o.ref} disabled={busy === 'st' + o.id} onClick={() => advance(o.id)}>{ACTION[o.status]}<span className="sr">{T('orderSr', { ref: o.ref })}</span></button>
          </div>
        </div>
        {!compact && (
          <details className="oitems" open={o.status === 'new'}>
            <summary>{d.details} · {d.kits(kits)}</summary>
            {o.items.map((it, ii) => {
              const cf = it.cfg, n = sheetsOf(it), dz = kit.D(cf.design)!, forOrder = T('forOrder', { name: dz.name, ref: o.ref }), key = `dl${o.id}.${ii}`;
              return (
                <div className="oitem" key={ii}>
                  <Mold cfg={cf} label={T('moldPreview', { name: dz.name })} />
                  <div>
                    <h4>{dz.name} · {T.n('doorStickers', n)}</h4>
                    <p>{kit.descOf(cf)}<br />{T('qtyLine', { q: it.qty, price: euro(it.list * it.qty) })}
                      {cf.numberOn && cf.number && <><br />{T('badgeIn', { text: '\u0000', colour: kit.COLORS[cf.c1].name }).split('\u0000').map((p, k) => (k ? [<b key="b">{cf.number}</b>, p] : p))}</>}</p>
                    <div className="btns">
                      <button className="btn btn-primary" type="button" disabled={busy === key} onClick={() => download(cf, 'png', o.ref, key)}>{T('dlPng')}<span className="sr">{forOrder}</span></button>
                      <button className="btn btn-ghost" type="button" onClick={() => download(cf, 'svg', o.ref, key)}>{T('dlSvg')}<span className="sr">{forOrder}</span></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </details>
        )}
      </article>
    );
  });

  const repeatAll = custAll.filter((x) => x.orders > 1).length;
  const sortedCusts = [...custs].sort((a: CustomerRow, b: CustomerRow) => cSort === 'orders' ? b.orders - a.orders || b.spent - a.spent : cSort === 'last' ? b.last.getTime() - a.last.getTime() : b.spent - a.spent);
  const statusRows = (['new', 'printed', 'shipped'] as const).map((s) => ({ key: s, label: STATUS[s], value: cur.filter((o) => o.status === s).length }));
  const openKits = allOpen.reduce((s, o) => s + o.items.length, 0);

  const toolSection = (
    <section className="adm-tool" aria-labelledby="admToolTitle">
      <h2 id="admToolTitle">{c.toolTitle}</h2>
      <p className="adm-note">{c.toolNote}</p>
      <div className="adm-bar">
        <label htmlFor="admDesign">{c.design}</label>
        <select className="field adm-select" id="admDesign" value={testId} onChange={(e) => setTestId(e.target.value)}>{kit.DESIGNS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <button className="btn btn-primary" type="button" id="admTestPng" disabled={busy === 'tpng'} aria-busy={busy === 'tpng' || undefined} onClick={() => download(testCfg(), 'png', 'TEST', 'tpng')}>{c.png}</button>
        <button className="btn btn-ghost" type="button" id="admTestSvg" onClick={() => download(testCfg(), 'svg', 'TEST', 'tsvg')}>{c.svg}</button>
      </div>
      <Mold cfg={testCfgV} className="moldp adm-test-prev" label={T('moldPreview', { name: kit.D(testId)!.name })} />
    </section>
  );

  return (
    <section className="view adm" data-view="admin">
      <div className="page-head">
        <span className="eyebrow">{c.eyebrow}</span>
        <h1 className="display">{panel === 'main' ? d.tabs[tab] : c.h1}</h1>
        {panel !== 'main' && <p className="muted adm-lead">{c.lead}</p>}
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
          <div id="admMain" className="dash">
            <h2 className="sr" id="admListTitle" tabIndex={-1}>{c.listTitle}</h2>
            <div className="adm-bar dash-top">
              <span className="adm-note" id="admWho">{who}</span>
              <button className="btn btn-ghost" type="button" id="admRefresh" onClick={loadOrders}>{c.refresh}</button>
              <button className="btn btn-ghost" type="button" disabled={busy === 'out'} onClick={signOut}>{c.signOut}</button>
            </div>
            <p className="adm-note" id="admMsg" role="status" aria-live="polite">{msg}</p>

            <div className="dtabs" role="tablist" aria-label={d.tabsLabel}>
              {TABS.map((t, i) => (
                <button key={t} ref={(el) => { tabRefs.current[t] = el; }} role="tab" type="button" id={'tab-' + t} aria-selected={tab === t} aria-controls={'pane-' + t} tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)} onKeyDown={(e) => tabKeys(e, i)}>
                  {d.tabs[t]}{t === 'orders' && allOpen.length > 0 && <span className="dtab-badge" aria-label={`, ${allOpen.length} ${STATUS.new}`}>{allOpen.length}</span>}
                </button>
              ))}
            </div>

            <div role="tabpanel" id={'pane-' + tab} aria-labelledby={'tab-' + tab} className="dpane">
              {(tab === 'overview' || tab === 'reports' || tab === 'customers') && (
                <div className="dfilters"><span className="eyebrow">{d.range}</span>{rangeBar}</div>
              )}

              {tab === 'overview' && (<>
                <div className="kpis">
                  <KpiView {...kp} accent label={d.k.revenue} value={euro(K.revenue)} now={K.revenue} before={KP?.revenue} hint={d.kHint.revenue} />
                  <KpiView {...kp} label={d.k.orders} value={nf.format(K.orders)} now={K.orders} before={KP?.orders} />
                  <KpiView {...kp} label={d.k.aov} value={euro(K.aov)} now={K.aov} before={KP?.aov} />
                  <KpiView {...kp} label={d.k.units} value={nf.format(K.units)} now={K.units} before={KP?.units} />
                  <KpiView {...kp} label={d.k.toPrint} value={nf.format(allOpen.length)} hint={d.kHint.toPrint} />
                  <KpiView {...kp} label={d.k.issues} value={nf.format(K.issues)} hint={K.issues ? d.kHint.issues : undefined} />
                </div>
                <Card wide title={metric === 'revenue' ? d.trendTitle : d.trendOrders}>
                  <div className="seg seg-sm" role="group" aria-label={d.metric}>
                    <button type="button" aria-pressed={metric === 'revenue'} onClick={() => setMetric('revenue')}>{d.mRevenue}</button>
                    <button type="button" aria-pressed={metric === 'orders'} onClick={() => setMetric('orders')}>{d.mOrders}</button>
                  </div>
                  <TrendChart points={pts} value={(p) => (metric === 'revenue' ? p.revenue : p.orders)} fmtValue={(v) => (metric === 'revenue' ? euroShort(v) : nf.format(Math.round(v * 10) / 10))}
                    fmtX={xLabel} fmtTip={tip} label={metric === 'revenue' ? d.trendTitle : d.trendOrders} empty={d.noData} />
                  <details className="dtable">
                    <summary>{d.showTable}</summary>
                    <table><thead><tr><th scope="col">{d.date}</th><th scope="col">{d.mRevenue}</th><th scope="col">{d.mOrders}</th></tr></thead>
                      <tbody>{pts.filter((p) => p.orders).map((p) => <tr key={p.key}><td>{range === 'today' ? `${p.key}:00` : fmtDay(p.date, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td className="price">{euro(p.revenue)}</td><td>{p.orders}</td></tr>)}</tbody></table>
                  </details>
                </Card>
                <div className="dgrid">
                  <Card title={d.topDesigns} note={d.topDesignsNote}><BarList rows={rep.designs.slice(0, 5)} fmt={(v) => d.kits(v)} fmtSub={(r) => euro0(r.sub || 0)} empty={d.noData} /></Card>
                  <Card title={d.statusMix}><BarList rows={statusRows} fmt={(v) => nf.format(v)} empty={d.noData} /></Card>
                </div>
                <Card wide title={d.recent}>
                  <div className="orders">{cur.length ? ordersList(cur.slice(0, 5), true) : <p className="adm-empty">{d.noData}</p>}</div>
                  {cur.length > 5 && <button className="btn btn-ghost dmore" type="button" onClick={() => setTab('orders')}>{d.seeAll}</button>}
                </Card>
              </>)}

              {tab === 'reports' && (<>
                <div className="kpis">
                  <KpiView {...kp} accent label={d.k.revenue} value={euro(K.revenue)} now={K.revenue} before={KP?.revenue} />
                  <KpiView {...kp} label={d.k.orders} value={nf.format(K.orders)} now={K.orders} before={KP?.orders} />
                  <KpiView {...kp} label={d.k.units} value={nf.format(K.units)} now={K.units} before={KP?.units} />
                  <KpiView {...kp} label={d.badge} value={pct(rep.badgeRate, locale)} hint={d.badgeOf(pct(rep.badgeRate, locale))} />
                </div>
                <div className="dgrid">
                  <Card title={d.topDesigns} note={d.topDesignsNote}><BarList rows={rep.designs} fmt={(v) => d.kits(v)} fmtSub={(r) => euro0(r.sub || 0)} empty={d.noData} /></Card>
                  <Card title={d.colours} note={d.coloursNote}><BarList swatches rows={rep.colours} fmt={(v) => nf.format(v)} empty={d.noData} /></Card>
                  <Card title={d.kitType}><BarList rows={rep.kitType} fmt={(v) => d.kits(v)} empty={d.noData} /></Card>
                  <Card title={d.finish}><BarList rows={rep.finish} fmt={(v) => d.kits(v)} empty={d.noData} /></Card>
                  <Card title={d.model}><BarList rows={rep.model} fmt={(v) => d.kits(v)} empty={d.noData} /></Card>
                  <Card title={d.countries}><BarList rows={rep.countries} fmt={(v) => d.ordersN(v)} fmtSub={(r) => euro0(r.sub || 0)} empty={d.noData} /></Card>
                  <Card title={d.cities}><BarList rows={rep.cities} fmt={(v) => d.ordersN(v)} fmtSub={(r) => euro0(r.sub || 0)} empty={d.noData} /></Card>
                  <Card title={d.weekdays}><Columns values={rep.weekday} labels={d.wd} fmt={(v) => nf.format(v)} label={d.weekdays} /></Card>
                  <Card wide title={d.hours}><Columns values={rep.hour} labels={rep.hour.map((_, h) => (h % 3 === 0 ? String(h) : ''))} fmt={(v) => nf.format(v)} label={d.hours} /></Card>
                </div>
                <p className="adm-note">{d.limitNote}</p>
              </>)}

              {tab === 'orders' && (<>
                <div className="ofilters">
                  <div className="co-f of-q"><label htmlFor="admQ">{d.search}</label><input className="field" id="admQ" type="search" placeholder={d.searchPh} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false} /></div>
                  <div className="co-f"><label htmlFor="admFS">{d.status}</label>
                    <select className="field" id="admFS" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
                      <option value="all">{d.all}</option>{(['new', 'printed', 'shipped'] as const).map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}
                    </select></div>
                  <div className="co-f"><label htmlFor="admFP">{d.payment}</label>
                    <select className="field" id="admFP" value={fPay} onChange={(e) => setFPay(e.target.value)}>
                      <option value="all">{d.all}</option><option value="paid">{d.paid}</option><option value="mismatch">{d.mismatch}</option>
                    </select></div>
                  <div className="co-f"><label htmlFor="admSort">{d.sort}</label>
                    <select className="field" id="admSort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                      {(Object.keys(d.sorts) as (keyof typeof d.sorts)[]).map((s) => <option key={s} value={s}>{d.sorts[s]}</option>)}
                    </select></div>
                </div>
                <div className="adm-bar">
                  <span className="adm-note ocount">{d.showing(shown.length, orders.length)} · {openKits ? d.bulkNote(openKits) : d.bulkNone}</span>
                  <button className="btn btn-ghost" type="button" onClick={exportCSV} disabled={!shown.length}>{d.exportCsv}</button>
                  <button className="btn btn-primary" type="button" onClick={() => bulk('png')} disabled={!openKits || busy === 'bulk'} aria-busy={busy === 'bulk' || undefined}>{d.bulkPng}</button>
                  <button className="btn btn-ghost" type="button" onClick={() => bulk('svg')} disabled={!openKits || busy === 'bulk'}>{d.bulkSvg}</button>
                </div>
                <div className="orders" id="admOrders">
                  {!orders.length && <p className="adm-empty">{T('noOrders')}</p>}
                  {ordersList(shown.slice(0, limit), false)}
                  {shown.length > limit && <button className="btn btn-ghost dmore" type="button" onClick={() => setLimit((n) => n + 20)}>{d.more(Math.min(20, shown.length - limit))}</button>}
                </div>
              </>)}

              {tab === 'customers' && (<>
                <div className="kpis">
                  <KpiView {...kp} accent label={d.custCount} value={nf.format(custs.length)} now={custs.length} before={KP?.customers} />
                  <KpiView {...kp} label={d.avgSpend} value={euro(custs.length ? custs.reduce((s, x) => s + x.spent, 0) / custs.length : 0)} />
                  <KpiView {...kp} label={d.repeat} value={custAll.length ? pct(repeatAll / custAll.length, locale) : '–'} hint={d.repeatOf(nf.format(repeatAll))} />
                </div>
                <Card wide title={d.custTitle}>
                  {!sortedCusts.length ? <p className="adm-empty">{d.noCustomers}</p> : (
                    <div className="ctable-wrap">
                      <table className="ctable">
                        <thead><tr>
                          <th scope="col">{d.cName}</th><th scope="col">{d.cPlace}</th>
                          {([['orders', d.cOrders], ['spent', d.cSpent], ['last', d.cLast]] as const).map(([k, l]) => (
                            <th scope="col" key={k} aria-sort={cSort === k ? 'descending' : undefined}><button type="button" onClick={() => setCSort(k)}>{l}{cSort === k ? ' ▾' : ''}</button></th>
                          ))}
                        </tr></thead>
                        <tbody>{sortedCusts.map((x) => (
                          <tr key={x.email}>
                            <td><b>{x.name || x.email}</b><br /><span className="muted">{x.email}</span></td>
                            <td>{[x.city, x.country].filter(Boolean).join(', ')}</td>
                            <td>{x.orders}{x.orders > 1 && <span className="acct-pill crepeat">{d.repeatTag}</span>}</td>
                            <td className="price">{euro(x.spent)}</td>
                            <td>{isNaN(x.last.getTime()) ? '' : fmtDay(x.last, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </>)}

              {tab === 'tools' && toolSection}
            </div>
          </div>
        )}

        {panel !== 'main' && toolSection}
      </div>
    </section>
  );
}
