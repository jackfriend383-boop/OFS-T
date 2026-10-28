/* Customer account: passwordless sign-in (a one-time link by email), saved details, order history, sign out, delete account.
   The link opens /account/#token=...; the token is read from the #fragment (never sent to a server), removed from the address bar
   at once and exchanged for a session by the Worker. */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { useApp, hasPendingAdd } from '../state';
import { COUNTRIES_EN } from '../components/Cart';
import type { Customer } from '../lib/backend';

const slot = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

export default function Account() {
  const { T, kit, backend, account, setCustomer, signOutCustomer, to, finishPendingAdd } = useApp();
  const [phase, setPhase] = useState<'idle' | 'age' | 'verifying' | 'sent'>('idle');
  const [err, setErr] = useState('');
  const [email, setEmail] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [busy, setBusy] = useState(false);
  const used = useRef('');
  const linkToken = useRef(''); // kept while a new customer enters their date of birth
  const { hash } = useLocation();
  // Sent here from "Add to cart" / checkout as a guest: explain why (read after mount: localStorage is browser-only).
  const [mustSignIn, setMustSignIn] = useState(false);
  useEffect(() => { setMustSignIn(hasPendingAdd(kit)); }, [kit]);

  // Arriving from the emailed link: trade the token in the #fragment for a session, then clean the address bar.
  // (A token is only ever sent once, even though React runs effects twice in development.)
  useEffect(() => {
    const m = /(?:^|[#&])token=([A-Za-z0-9_-]{20,100})/.exec(hash);
    if (!m || used.current === m[1]) return;
    used.current = m[1];
    history.replaceState(null, '', location.pathname + location.search);
    setPhase('verifying');
    // Signed in: if they came from "Add to cart", the kit is added and they go back to where they were with the cart open.
    backend.verifyLink(m[1]).then((r) => {
      if ('needsBirthDate' in r) { linkToken.current = m[1]; setPhase('age'); return; } // new account: confirm age first
      setCustomer(r); setPhase('idle'); finishPendingAdd();
    }).catch((e) => { setErr(e.message || T('beGeneric')); setPhase('idle'); });
  }, [hash, backend, setCustomer, T, finishPendingAdd]);

  /* New customer, after opening the emailed link: confirm the date of birth, then the account is created and signed in. */
  async function confirmAge(e: FormEvent) {
    e.preventDefault();
    if (busy || !birthDate) return;
    setErr(''); setBusy(true);
    try {
      const r = await backend.verifyLink(linkToken.current, birthDate);
      if ('needsBirthDate' in r) return;
      linkToken.current = ''; setCustomer(r); setPhase('idle'); finishPendingAdd();
    } catch (x: any) { setErr(x.message || T('beGeneric')); if (x.code !== 'invalid') setPhase('idle'); }
    finally { setBusy(false); }
  }

  async function continueWithEmail(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setErr(''); setBusy(true);
    try {
      await backend.requestLink(email);
      setPhase('sent');
    } catch (x: any) { setErr(x.message || T('beGeneric')); }
    finally { setBusy(false); }
  }

  const user = account.user;
  const h1 = phase === 'verifying' ? T('acctVerifying') : user ? (user.name ? slot(T('acctH1In'), { name: user.name.split(/\s+/)[0] }) : T('acctH1InNoName')) : T('acctH1Out');

  return (
    <section className="view" data-view="account">
      <div className="page-head">
        <span className="eyebrow">{T('acctEyebrow')}</span>
        <h1 className="display">{h1}</h1>
        <p className="sr" role="status" aria-live="polite">{h1}</p>
        {!user && phase !== 'verifying' && mustSignIn && <p className="note" role="status" style={{ margin: 0, maxWidth: '56ch' }}>{T('acctSignInFirst')}</p>}
        {!user && phase === 'idle' && <p className="muted" style={{ margin: 0, maxWidth: '56ch' }}>{T('acctLeadOut')}</p>}
        {user && <p className="muted" style={{ margin: 0 }}>{T('acctSignedInAs')} <b>{user.email}</b></p>}
      </div>
      <div className="section acct" style={{ paddingTop: 8 }}>
        {err && <p className="err acct-msg" role="alert">{err}</p>}
        {!backend.configured && <p className="note">{T('beConfig')}</p>}

        {backend.configured && !user && phase !== 'verifying' && account.ready && (
          phase === 'sent' ? (
            <div className="acct-card">
              <h2>{T('acctSentH')}</h2>
              <p className="muted">{slot(T('acctSentText'), { email })}</p>
              <button type="button" className="btn btn-ghost" onClick={() => { setPhase('idle'); setErr(''); }}>{T('acctOtherEmail')}</button>
            </div>
          ) : phase === 'age' ? (
            <form className="acct-card co" noValidate onSubmit={confirmAge}>
              <div className="co-f">
                <label htmlFor="acBirthDate">{T('acctBirthDate')}</label>
                <input className="field" id="acBirthDate" type="date" autoComplete="bday" required max={new Date().toISOString().slice(0, 10)}
                  value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
                <p className="muted">{T('acctAgeNote')}</p>
              </div>
              <div className="acct-actions">
                <button className="btn btn-primary" type="submit" disabled={busy || !birthDate} aria-busy={busy || undefined}>{T('acctContinue')}</button>
              </div>
            </form>
          ) : (
            <form className="acct-card co" noValidate onSubmit={continueWithEmail}>
              <div className="co-f">
                <label htmlFor="acEmail">{T('acctEmail')}</label>
                <input className="field" id="acEmail" type="email" autoComplete="email" inputMode="email" autoCapitalize="off" spellCheck={false} required
                  value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy || undefined}>{T('acctContinue')}</button>
            </form>
          )
        )}

        {user && <Signed user={user} kit={kit} onSaved={setCustomer} onSignOut={signOutCustomer} to={to} />}
      </div>
    </section>
  );
}

function Signed({ user, kit, onSaved, onSignOut, to }: { user: Customer; kit: ReturnType<typeof useApp>['kit']; onSaved: (u: Customer | null) => void; onSignOut: () => Promise<void>; to: ReturnType<typeof useApp>['to'] }) {
  const { T, backend } = useApp();
  const countryLabels: string[] = (() => { const l = T.raw('countries'); return Array.isArray(l) && l.length === COUNTRIES_EN.length ? l : COUNTRIES_EN; })();
  const [f, setF] = useState({ name: user.name || '', phone: user.phone || '', street: user.street || '', postcode: user.postcode || '', city: user.city || '', country: user.country || 'Portugal' });
  const [msg, setMsg] = useState<{ cls: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [orders, setOrders] = useState<any[] | null>(null);
  const [ordersErr, setOrdersErr] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  useEffect(() => {
    let live = true;
    backend.myOrders().then((o) => live && setOrders(o)).catch((e) => { if (live) { setOrders([]); setOrdersErr(e.message || ''); } });
    return () => { live = false; };
  }, [backend]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setMsg(null);
    try { onSaved(await backend.saveProfile(f)); setMsg({ cls: 'note', text: T('acctSaved') }); }
    catch (x: any) { setMsg({ cls: 'err', text: x.message || T('beGeneric') }); }
    finally { setSaving(false); }
  }
  async function del() {
    try { await backend.deleteAccount(); onSaved(null); window.location.assign(to('home')); }
    catch (x: any) { setMsg({ cls: 'err', text: x.message || T('beGeneric') }); setConfirmDel(false); }
  }

  const stLabel: Record<string, string> = { new: T('acctStNew'), printed: T('acctStPrinted'), shipped: T('acctStShipped') };
  const date = (s: string) => { try { return new Date(s).toLocaleDateString(T.locale, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return s.slice(0, 10); } };
  const input = (id: keyof typeof f, label: string, extra: Record<string, unknown> = {}) => (
    <div className="co-f"><label htmlFor={'ac_' + id}>{label}</label><input className="field" id={'ac_' + id} value={f[id]} onChange={set(id)} maxLength={id === 'street' ? 300 : 200} {...extra} /></div>
  );

  return (
    <>
      <form className="acct-card co" onSubmit={save} noValidate>
        <h2>{T('acctProfileH')}</h2>
        <p className="muted" style={{ margin: 0 }}>{T('acctProfileNote')}</p>
        {input('name', T('fName'), { autoComplete: 'name' })}
        {input('phone', T('acctPhone'), { autoComplete: 'tel', type: 'tel', inputMode: 'tel' })}
        {input('street', T('fAddr'), { autoComplete: 'address-line1' })}
        <div className="co-2">{input('postcode', T('fPost'), { autoComplete: 'postal-code', maxLength: 20 })}{input('city', T('fCity'), { autoComplete: 'address-level2', maxLength: 120 })}</div>
        <div className="co-f">
          <label htmlFor="ac_country">{T('fCountry')}</label>
          <select className="field" id="ac_country" value={f.country} onChange={set('country')} autoComplete="country-name">{COUNTRIES_EN.map((c, i) => <option key={c} value={c}>{countryLabels[i]}</option>)}</select>
        </div>
        {msg && <p className={msg.cls} role={msg.cls === 'err' ? 'alert' : 'status'}>{msg.text}</p>}
        <button className="btn btn-primary" type="submit" disabled={saving} aria-busy={saving || undefined}>{saving ? T('acctSaving') : T('acctSave')}</button>
      </form>

      <div className="acct-card" id="orders">
        <h2>{T('acctOrdersH')}</h2>
        {orders === null && <p className="muted">{T('acctLoadingOrders')}</p>}
        {ordersErr && <p className="err">{ordersErr}</p>}
        {orders && !orders.length && !ordersErr && <p className="muted">{T('acctNoOrders')}</p>}
        {orders && orders.length > 0 && (
          <ul className="acct-orders" role="list">
            {orders.map((o) => (
              <li key={o.id}>
                <div className="acct-order-head">
                  <b>{slot(T('acctOrderN'), { ref: String(o.id).slice(-6).toUpperCase() })}</b>
                  <span className="muted">{date(o.created_at)}</span>
                  <span className="acct-pill">{stLabel[o.status] || o.status}</span>
                  <span className="price">{kit.money(o.total_cents / 100)}</span>
                </div>
                <ul className="acct-lines" role="list">
                  {(Array.isArray(o.items) ? o.items : []).map((i: any, n: number) => <li key={n}>{String(i.name)} × {Number(i.qty)}<span className="muted"> · {String(i.desc)}</span></li>)}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="acct-card">
        <div className="acct-actions">
          <button type="button" className="btn btn-ghost" onClick={() => { void onSignOut(); }}>{T('acctSignOut')}</button>
          <Link className="btn btn-ghost" to={to('shop')}>{T('orderBackShop')}</Link>
        </div>
      </div>

      <div className="acct-card">
        <h2>{T('acctDangerH')}</h2>
        <p className="muted" style={{ margin: 0 }}>{T('acctDangerText')}</p>
        {confirmDel ? (
          <div className="acct-actions">
            <button type="button" className="btn acct-danger" onClick={del}>{T('acctDeleteConfirm')}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDel(false)}>{T('acctCancel')}</button>
          </div>
        ) : <button type="button" className="btn btn-ghost acct-danger-outline" onClick={() => setConfirmDel(true)}>{T('acctDeleteBtn')}</button>}
      </div>
    </>
  );
}
