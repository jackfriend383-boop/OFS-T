/* Admin "Encomendas" tab: create an order by hand (taken outside the site). The worker checks and prices it exactly like a checkout
   (worker/src/index.ts createManualOrder) and stores it as paid. */
import { useState, type FormEvent } from 'react';
import { useApp } from '../../state';
import { DASH } from './copy';
import { COUNTRIES_EN } from '../../components/Cart';
import KitFields, { baseCfg } from './KitFields';
import type { Cfg } from '../../lib/kit';

interface Line { key: number; cfg: Cfg; qty: number }
let seq = 0;

export default function NewOrder({ onClose, onCreated, onError }: { onClose: () => void; onCreated: (ref: string) => void; onError: (e: any) => void }) {
  const { kit, T, lang, backend } = useApp();
  const d = DASH[lang];
  const countryLabels: string[] = (() => { const l = T.raw('countries'); return Array.isArray(l) && l.length === COUNTRIES_EN.length ? l : COUNTRIES_EN; })();
  const [f, setF] = useState({ name: '', email: '', street: '', postcode: '', city: '', country: 'Portugal', nif: '' });
  const [lines, setLines] = useState<Line[]>(() => [{ key: ++seq, cfg: baseCfg(kit, kit.DESIGNS[0].id), qty: 1 }]);
  const [orderLang, setOrderLang] = useState<'pt' | 'en'>(lang === 'en' ? 'en' : 'pt');
  const [price, setPrice] = useState('');
  const [mail, setMail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const setLine = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const list = lines.reduce((s, l) => s + kit.priceOf(l.cfg) * l.qty, 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr('');
    const paid = price.trim() === '' ? undefined : Number(price.replace(',', '.'));
    if (paid !== undefined && !(paid >= 0.01 && paid <= 10000)) { setErr(d.noPriceBad); return; }
    const customer: Record<string, string> = { name: f.name.trim(), email: f.email.trim(), street: f.street.trim(), postcode: f.postcode.trim(), city: f.city.trim(), country: f.country };
    if (f.nif.trim()) customer.nif = f.nif.trim();
    setBusy(true);
    try {
      const r = await backend.createOrder({ customer, items: lines.map((l) => ({ cfg: l.cfg, qty: l.qty })), lang: orderLang, paid_eur: paid, send_email: mail });
      onCreated(r.ref);
    } catch (x: any) {
      if (x && x.code === 'session_expired') onError(x);
      else setErr(x && x.code === 'invalid' ? d.noBad : (x && x.message) || d.noBad);
    } finally { setBusy(false); }
  }

  const field = (id: keyof typeof f, label: string, extra: Record<string, unknown> = {}) => (
    <div className="co-f"><label htmlFor={'no_' + id}>{label}</label><input className="field" id={'no_' + id} value={f[id]} onChange={set(id)} required={id !== 'nif'} maxLength={id === 'street' ? 300 : 200} {...extra} /></div>
  );

  return (
    <form className="adm-panel no-form" id="admNewOrder" noValidate={false} onSubmit={submit} aria-labelledby="noTitle">
      <h2 id="noTitle" tabIndex={-1}>{d.noTitle}</h2>
      <p className="adm-note">{d.noNote}</p>

      <fieldset className="no-set">
        <legend>{d.noCustomer}</legend>
        <div className="no-grid">
          {field('name', T('fName'), { autoComplete: 'off' })}
          {field('email', T('fEmail'), { type: 'email', inputMode: 'email', autoCapitalize: 'off', spellCheck: false })}
          {field('street', T('fAddr'))}
          {field('postcode', T('fPost'), { maxLength: 20 })}
          {field('city', T('fCity'), { maxLength: 120 })}
          <div className="co-f">
            <label htmlFor="no_country">{T('fCountry')}</label>
            <select className="field" id="no_country" value={f.country} onChange={set('country')}>{COUNTRIES_EN.map((c, i) => <option key={c} value={c}>{countryLabels[i]}</option>)}</select>
          </div>
          {field('nif', T('fNif'), { inputMode: 'numeric', maxLength: 20 })}
          <div className="co-f">
            <label htmlFor="no_lang">{d.noLang}</label>
            <select className="field" id="no_lang" value={orderLang} onChange={(e) => setOrderLang(e.target.value === 'en' ? 'en' : 'pt')}><option value="pt">Português</option><option value="en">English</option></select>
          </div>
        </div>
      </fieldset>

      <fieldset className="no-set">
        <legend>{d.noKits}</legend>
        {lines.map((l, i) => (
          <div className="no-line" key={l.key}>
            <div className="no-line-head">
              <b>{d.noKitN(i + 1)}</b>
              {lines.length > 1 && <button type="button" className="btn btn-ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>{d.noRemove}</button>}
            </div>
            <KitFields cfg={l.cfg} onChange={(cfg) => setLine(l.key, { cfg })} />
            <div className="co-f no-qty">
              <label htmlFor={'no_qty' + l.key}>{d.noQty}</label>
              <input className="field" id={'no_qty' + l.key} type="number" min={1} max={99} value={l.qty} onChange={(e) => setLine(l.key, { qty: Math.min(99, Math.max(1, Math.floor(+e.target.value) || 1)) })} />
              <span className="muted">{kit.money(kit.priceOf(l.cfg) * l.qty)}</span>
            </div>
          </div>
        ))}
        {lines.length < 20 && <button type="button" className="btn btn-ghost" onClick={() => setLines((ls) => [...ls, { key: ++seq, cfg: baseCfg(kit, ls[ls.length - 1].cfg.design), qty: 1 }])}>{d.noAddKit}</button>}
      </fieldset>

      <div className="no-grid">
        <div className="co-f">
          <label htmlFor="no_price">{d.noPrice}</label>
          <input className="field" id="no_price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={String(list)} />
          <p className="adm-note">{d.noPriceHint(kit.money(list))}</p>
        </div>
        <label className="no-check"><input type="checkbox" checked={mail} onChange={(e) => setMail(e.target.checked)} /> {d.noMail}</label>
      </div>

      {err && <p className="err" role="alert">{err}</p>}
      <div className="adm-bar">
        <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy || undefined}>{busy ? d.noCreating : d.noCreate}</button>
        <button className="btn btn-ghost" type="button" onClick={onClose} disabled={busy}>{d.noCancel}</button>
      </div>
    </form>
  );
}
