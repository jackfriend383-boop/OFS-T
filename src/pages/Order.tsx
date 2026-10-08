/* Where Stripe sends the customer back to (/order/?o=<order id>). Shows the payment result; the paid state comes from the Worker,
   which only sets it after Stripe's signed webhook, so this page cannot be tricked by editing the URL. */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useApp } from '../state';
import { isUUID } from '../lib/backend';

type View = 'checking' | 'paid' | 'pending' | 'cancelled' | 'failed' | 'unknown';
const POLL_MS = 3000, POLL_MAX = 40; // wait up to ~2 minutes for the webhook (slower methods can take longer; we email then)

export default function Order() {
  const { T, to, backend, clearCart, openModal } = useApp();
  const { search } = useLocation();
  const [view, setView] = useState<View>('checking');
  const [ref, setRef] = useState('');

  useEffect(() => {
    const q = new URLSearchParams(search);
    const id = q.get('o') || '';
    if (!isUUID(id)) { setView('unknown'); return; }
    setRef(id.slice(-6).toUpperCase());
    // Came back from Stripe without paying: close that payment session so no unpaid order is kept.
    if (q.get('cancelled') === '1') { setView('cancelled'); void backend.cancelCheckout(id); return; }
    // Stripe only sends the customer here (without ?cancelled) after the checkout was completed, so the cart is done with.
    // Cleared now rather than waiting for the paid confirmation, which can take a while (or days for Multibanco).
    clearCart();
    let stop = false, tries = 0, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let status: string | null = null;
      try { status = await backend.orderStatus(id); } catch { /* network blip: keep trying */ }
      if (stop) return;
      if (status === 'paid') { setView('paid'); return; }
      if (status === 'failed' || status === 'expired') { setView('failed'); return; }
      if (status === null && tries === 0) { setView('unknown'); return; }
      setView('pending');
      if (++tries < POLL_MAX) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [search, backend, clearCart]);

  const [h, text] = {
    checking: [T('orderChecking'), ''],
    paid: [T('orderPaidH'), T('orderPaidText')],
    pending: [T('orderPendingH'), T('orderPendingText')],
    cancelled: [T('orderCancelledH'), T('orderCancelledText')],
    failed: [T('orderFailedH'), T('orderFailedText')],
    unknown: [T('orderUnknownH'), T('orderUnknownText')],
  }[view];

  return (
    <section className="view" data-view="order">
      <div className="page-head">
        <span className="eyebrow">{T('orderEyebrow')}</span>
        <h1 className="display" role="status" aria-live="polite">{h}</h1>
        {text && <p className="muted" style={{ margin: 0, maxWidth: '56ch' }}>{text}</p>}
        {ref && view !== 'unknown' && <p className="muted" style={{ margin: 0 }}>{T('orderRef')}: <b className="mono">{ref}</b></p>}
        <div className="hero-cta">
          {(view === 'cancelled' || view === 'failed' || view === 'unknown') && <button type="button" className="btn btn-primary" onClick={() => openModal('cart')}>{T('orderOpenCart')}</button>}
          <Link className={'btn ' + (view === 'paid' ? 'btn-primary' : 'btn-ghost')} to={to('shop')}>{T('orderBackShop')}</Link>
        </div>
      </div>
    </section>
  );
}
