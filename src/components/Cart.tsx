/* Cart drawer: items, quantity, checkout form, order confirmation. Orders go to the backend (Cloudflare Worker) when it is configured;
   otherwise the form says so and keeps the cart. Only kit configurations are stored in the browser, never personal data. */
import { Fragment, useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useApp } from '../state';
import { Thumb } from './Car';
import { dec } from './Html';
import { easeInCartItems } from '../lib/motion';

/* "text {slot} text" with a React node in place of {slot}. */
function slot(str: string, name: string, node: ReactNode): ReactNode {
  const [a, ...rest] = str.split(`{${name}}`);
  return rest.length ? <>{a}{node}{rest.join(`{${name}}`)}</> : str;
}

const COUNTRIES_EN = ['Portugal', 'Spain', 'France', 'Italy', 'Germany', 'Netherlands', 'Belgium'];

export function CartDrawer() {
  const { kit, T, to, lang, cart, changeQty, removeItem, clearCart, modal, closeModal, drawerMode, setDrawerMode, announce, live, backend, onEditConfig } = useApp();
  const open = modal === 'cart';
  const body = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusSel = useRef<string | null>(null);
  const [done, setDone] = useState<{ first: string; ref: string } | null>(null);
  const title = drawerMode === 'checkout' ? T('checkout') : drawerMode === 'ok' ? T('orderReceived') : T('cartTitle');
  const money = kit.money;

  // Focus follow-ups requested by an action (after the DOM has been updated).
  useEffect(() => {
    const sel = focusSel.current; if (!sel) return;
    focusSel.current = null;
    const el = (sel === 'title' ? titleRef.current : (body.current?.querySelector(sel) ?? null)) as HTMLElement | null;
    (el || titleRef.current)?.focus();
  });
  useEffect(() => { if (open) easeInCartItems(); }, [open]);
  useEffect(() => { if (!open && drawerMode === 'ok') setDrawerMode('cart'); }, [open, drawerMode, setDrawerMode]);

  const editHref = (i: number) => to('configurator', kit.cfgQuery(cart[i].cfg));
  const sub = cart.reduce((s, i) => s + kit.priceOf(i.cfg) * i.qty, 0);

  const cartView = !cart.length ? (
    <div className="empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true" focusable="false"><path d="M3 4h2.2l2.3 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L20.6 8H6.1" /></svg>
      <span>{T('cartEmpty')}</span>
      <Link className="btn btn-primary" to={to('configurator')} onClick={() => closeModal(false)}>{T('designKit')}</Link>
    </div>
  ) : (
    <ul className="citems" role="list">
      {cart.map((i, ix) => {
        const d = kit.D(i.cfg.design)!, name = d.name, t = (k: string) => T(k, { name });
        return (
          <li className="citem" key={i.key}>
            <Link className="mini" to={editHref(ix)} data-edit={ix} title={T('editTitle')} aria-label={t('editAria')}
              onClick={(e) => { if (onEditConfig.current) { e.preventDefault(); onEditConfig.current({ ...i.cfg }); closeModal(); } }}>
              <Thumb cfg={i.cfg} eager className="" />
            </Link>
            <div>
              <h3>{name}</h3><p>{kit.descOf(i.cfg)}</p>
              <div className="citem-row">
                <div className="qty" role="group" aria-label={t('qtyGroup')}>
                  <button type="button" data-q={ix} data-d="-1" aria-label={t('qtyDec')} onClick={() => { changeQty(ix, -1); focusSel.current = i.qty - 1 < 1 ? 'title' : `[data-q="${ix}"][data-d="-1"]`; announce(i.qty - 1 < 1 ? T('removed', { name }) : T('qtyNow', { name, n: i.qty - 1 }), 'cartLive'); }}>−</button>
                  <span>{i.qty}</span>
                  <button type="button" data-q={ix} data-d="1" aria-label={t('qtyInc')} disabled={i.qty >= 99} onClick={() => { changeQty(ix, 1); focusSel.current = `[data-q="${ix}"][data-d="1"]:not([disabled]),[data-q="${ix}"]`; announce(T('qtyNow', { name, n: Math.min(99, i.qty + 1) }), 'cartLive'); }}>+</button>
                </div>
                <span className="price">{money(kit.priceOf(i.cfg) * i.qty)}</span>
              </div>
              <button type="button" className="rm" style={{ marginTop: 8 }} onClick={() => { removeItem(ix); focusSel.current = '.rm'; announce(T('removed', { name }), 'cartLive'); }}>{T('remove')}<span className="sr">{t('removeSr')}</span></button>
            </div>
          </li>
        );
      })}
    </ul>
  );
  const cartFoot = cart.length ? (
    <>
      <div className="row"><span className="muted">{T('subtotal')}</span><span className="price">{money(sub)}</span></div>
      <div className="row"><span className="muted">{T('shipping')}</span><span className="price">{T('shippingCalc')}</span></div>
      <div className="row big"><span>{T('total')}</span><span className="price">{money(sub)}</span></div>
      <button type="button" className="btn btn-primary" id="checkout" onClick={() => { setDrawerMode('checkout'); }}>{T('checkout')}</button>
    </>
  ) : null;

  return (
    <div className={'drawer' + (open ? ' on' : '')} id="drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle">
      <div className="drawer-head">
        <h2 id="drawerTitle" tabIndex={-1} ref={titleRef}>{title}</h2>
        <button type="button" className="icon-btn" id="closeCart" aria-label={kit.L.ui.t_close_cart} onClick={() => closeModal()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
      </div>
      <div className="drawer-body" id="cartBody" ref={body}>
        {drawerMode === 'cart' && cartView}
        {drawerMode === 'checkout' && <Checkout key={lang} onBack={() => { setDrawerMode('cart'); focusSel.current = '#checkout'; }} onDone={(r) => { setDone(r); clearCart(); setDrawerMode('ok'); focusSel.current = 'title'; }} />}
        {drawerMode === 'ok' && done && (
          <div className="ok">
            <span className="tick" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" focusable="false"><path d="m5 12 5 5 9-10" /></svg></span>
            <h3 style={{ margin: 0 }}>{T('thanks', { name: done.first })}</h3>
            <p className="muted" style={{ margin: 0, maxWidth: '32ch' }}>{T('receivedBody')}{done.ref && slot(T('refLine'), 'ref', <b className="mono">{done.ref}</b>)}</p>
            <p className="note" style={{ margin: 0, maxWidth: '32ch' }}>{T('noPaymentShort')}</p>
          </div>
        )}
      </div>
      <div className="drawer-foot" id="cartFoot">{drawerMode === 'cart' && cartFoot}</div>
      <p className="sr" id="cartLive" role="status" aria-live="polite">{live.cartLive}</p>
    </div>
  );
}

/* ---------- Checkout ---------- */
const FIELDS = [
  { id: 'coName', label: 'fName', ac: 'name', msg: 'fNameMsg', props: { autoCapitalize: 'words' } },
  { id: 'coEmail', label: 'fEmail', ac: 'email', type: 'email', msg: 'fEmailMsg', props: { inputMode: 'email', autoCapitalize: 'off', spellCheck: false } },
  { id: 'coAddr', label: 'fAddr', ac: 'address-line1', msg: 'fAddrMsg', props: {} },
  { id: 'coPost', label: 'fPost', ac: 'postal-code', msg: 'fPostMsg', props: { autoCapitalize: 'characters', spellCheck: false } },
  { id: 'coCity', label: 'fCity', ac: 'address-level2', msg: 'fCityMsg', props: {} },
] as const;

function Checkout({ onBack, onDone }: { onBack: () => void; onDone: (r: { first: string; ref: string }) => void }) {
  const { kit, T, to, cart, backend } = useApp();
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ cls: string; node: ReactNode } | null>(null);
  const [sending, setSending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const pers = cart.some((i) => kit.isPersonalised(i.cfg));
  const countryLabels: string[] = (() => { const l = T.raw('countries'); return Array.isArray(l) && l.length === COUNTRIES_EN.length ? l : COUNTRIES_EN; })();
  useEffect(() => { formRef.current?.querySelector<HTMLElement>('#coName')?.focus(); }, []);

  const MSG: Record<string, string> = { coTerms: T('msgTerms'), coPers: T('msgPers') };
  FIELDS.forEach((f) => { MSG[f.id] = T(f.msg); });

  const mail = () => {
    const m = backend.email || '';
    if (/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(m)) return <a href={`mailto:${m}`}>{m}</a>;
    return <>{/^\[.*\]$/.test(m) ? T('emailPlaceholder') : m || T('ourContact')}</>; // unfilled [CONTACT EMAIL] placeholder: shown translated
  };
  const notSetUp = () => slot(T('notSetUp'), 'email', mail());

  function validate(el: HTMLInputElement | HTMLSelectElement): boolean {
    let msg = '';
    if ((el as HTMLInputElement).type === 'checkbox') msg = (el as HTMLInputElement).checked ? '' : MSG[el.id];
    else {
      const v = el.value.trim();
      if (!v) msg = MSG[el.id] || T('required');
      else if ((el as HTMLInputElement).type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) msg = T('badEmail');
    }
    setErrs((e) => ({ ...e, [el.id]: msg }));
    return !msg;
  }
  const recheck = (e: FormEvent) => { const el = e.target as HTMLInputElement; if (el.getAttribute?.('aria-invalid') === 'true') validate(el); };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const bad = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[required],select[required]')].filter((el) => !validate(el));
    if (bad.length) { bad[0].focus(); return; }
    if (!backend.configured) { setStatus({ cls: 'note', node: notSetUp() }); return; }
    if (sending) return;
    const val = (id: string) => ((form.querySelector('#' + id) as HTMLInputElement | null)?.value || '').trim();
    const first = val('coName').split(/\s+/)[0];
    setSending(true); setStatus(null);
    try {
      const res = await backend.submitOrder({
        customer: { name: val('coName'), email: val('coEmail'), street: val('coAddr'), postcode: val('coPost'), city: val('coCity'), country: val('coCountry') },
        items: cart.map((i) => ({ cfg: { ...i.cfg }, qty: i.qty })),
        consentTerms: !!(form.querySelector('#coTerms') as HTMLInputElement | null)?.checked,
        consentPersonalised: pers ? !!(form.querySelector('#coPers') as HTMLInputElement | null)?.checked : null,
      });
      onDone({ first, ref: res && res.ref ? res.ref : '' });
    } catch (err: any) {
      const msg = err && err.code === 'denied' ? T('orderDenied') : (err && err.message) || T('somethingWrong');
      setStatus({ cls: 'err', node: slot(T('orderFailed', { msg, email: '{email}' }), 'email', mail()) });
      setSending(false);
    }
  }

  const legal = (path: string, text: string) => <a href={import.meta.env.BASE_URL.replace(/\/$/, '') + to(path)} target="_blank" rel="noopener">{dec(text)}<span className="sr">{T('newTab')}</span></a>;
  const check = (id: string, label: ReactNode) => (
    <div className="co-f">
      <div className="co-check">
        <input type="checkbox" id={id} required aria-invalid={errs[id] ? true : undefined} aria-describedby={errs[id] ? id + 'Err' : undefined} />
        <label htmlFor={id}>{label}</label>
      </div>
      <p className="err" id={id + 'Err'} hidden={!errs[id]}>{errs[id]}</p>
    </div>
  );
  const field = (f: (typeof FIELDS)[number]) => (
    <div className="co-f" key={f.id}>
      <label htmlFor={f.id}>{T(f.label)}</label>
      <input className="field" id={f.id} name={f.ac} type={'type' in f ? f.type : 'text'} autoComplete={f.ac} required {...f.props}
        aria-invalid={errs[f.id] ? true : undefined} aria-describedby={errs[f.id] ? f.id + 'Err' : undefined} />
      <p className="err" id={f.id + 'Err'} hidden={!errs[f.id]}>{errs[f.id]}</p>
    </div>
  );
  const termsLabel = (() => {
    const parts = T('termsCheck').split(/(\{terms\}|\{refunds\}|\{privacy\})/);
    return parts.map((p, i) => <Fragment key={i}>{p === '{terms}' ? legal('terms/', T('termsLink')) : p === '{refunds}' ? legal('refunds/', T('refundsLink')) : p === '{privacy}' ? legal('privacy/', T('privacyLink')) : p}</Fragment>);
  })();

  return (
    <form className="co" id="coForm" ref={formRef} noValidate aria-describedby="coNote" onSubmit={submit} onInput={recheck} onChange={recheck}>
      {field(FIELDS[0])}{field(FIELDS[1])}{field(FIELDS[2])}
      <div className="co-2">{field(FIELDS[3])}{field(FIELDS[4])}</div>
      <div className="co-f">
        <label htmlFor="coCountry">{T('fCountry')}</label>
        <select className="field" id="coCountry" name="country" autoComplete="country-name" required>{COUNTRIES_EN.map((c, i) => <option key={c} value={c}>{countryLabels[i]}</option>)}</select>
      </div>
      {check('coTerms', termsLabel)}
      {pers && check('coPers', T('persCheck'))}
      <p className="note" id="coNote">{backend.configured ? T('noPayment') : notSetUp()}</p>
      <div id="coStatus" role="alert" className={status?.cls}>{status?.node}</div>
      <button className="btn btn-primary" type="submit" disabled={sending} aria-busy={sending || undefined}>{sending ? T('sending') : T('placeOrder')}</button>
      <button className="btn btn-ghost" type="button" id="coBack" onClick={onBack}>{T('backToCart')}</button>
    </form>
  );
}
