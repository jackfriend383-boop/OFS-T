/* Waiting list for people outside the São Miguel pre-sale (Portugal mainland and elsewhere): an email, the area, and a consent tick.
   POST /api/waitlist on the shop's server (worker/src/waitlist.ts); the owner reads the list in the admin "Waiting list" tab.
   The answer never says whether an email was already on the list, so the form always ends with the same thank-you. */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useApp } from '../state';

const TXT = {
  en: {
    eyebrow: 'Waiting list', title: 'Not in São Miguel? Be the first to know.',
    lead: 'The pre-sale is exclusive to São Miguel for now. Leave your email and we will tell you as soon as we deliver to your area.',
    email: 'Email', area: 'Where do you live?', mainland: 'Portugal mainland', madeira: 'Madeira', azores: 'Another Azores island', other: 'Another country',
    consent: (a: React.ReactNode) => <>I agree to be emailed about deliveries to my area. I can leave the list at any time. See the {a}.</>, privacy: 'privacy policy',
    send: 'Join the waiting list', sending: 'Sending…', done: 'You are on the list. We will email you when we reach your area.',
    badEmail: 'Enter a valid email address.', needConsent: 'Please tick the box to join the list.', failed: 'That did not work. Please try again in a moment.', rate: 'Too many attempts. Please try again later.',
  },
  pt: {
    eyebrow: 'Lista de espera', title: 'Não és de São Miguel? Sê dos primeiros a saber.',
    lead: 'Por agora a pré-venda é exclusiva para São Miguel. Deixa o teu email e avisamos-te assim que entregarmos na tua zona.',
    email: 'Email', area: 'Onde vives?', mainland: 'Portugal continental', madeira: 'Madeira', azores: 'Outra ilha dos Açores', other: 'Outro país',
    consent: (a: React.ReactNode) => <>Aceito receber um email sobre entregas na minha zona. Posso sair da lista quando quiser. Ver a {a}.</>, privacy: 'política de privacidade',
    send: 'Entrar na lista de espera', sending: 'A enviar…', done: 'Já estás na lista. Enviamos-te um email quando chegarmos à tua zona.',
    badEmail: 'Indica um email válido.', needConsent: 'Assinala a caixa para entrares na lista.', failed: 'Não funcionou. Tenta de novo daqui a pouco.', rate: 'Demasiadas tentativas. Tenta mais tarde.',
  },
};

export default function Waitlist({ id = 'waitlist' }: { id?: string }) {
  const { backend, lang, to } = useApp();
  const t = TXT[lang === 'pt' ? 'pt' : 'en'];
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [msg, setMsg] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state !== 'idle') return;
    const f = e.currentTarget;
    const email = (f.elements.namedItem('wlEmail') as HTMLInputElement).value.trim();
    const area = (f.elements.namedItem('wlArea') as HTMLSelectElement).value;
    const ok = (f.elements.namedItem('wlConsent') as HTMLInputElement).checked;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setMsg(t.badEmail); (f.elements.namedItem('wlEmail') as HTMLInputElement).focus(); return; }
    if (!ok) { setMsg(t.needConsent); return; }
    setState('sending'); setMsg('');
    try { await backend.joinWaitlist(email, area); setState('done'); }
    catch (err: any) { setState('idle'); setMsg(err && err.code === 'rate_limited' ? t.rate : t.failed); }
  }

  return (
    <section className="section waitlist" id={id} aria-labelledby={id + 'Title'}>
      <div className="wl-box">
        <div className="sec-head"><div><span className="eyebrow">{t.eyebrow}</span><h2 className="display" id={id + 'Title'}>{t.title}</h2></div></div>
        <p className="muted wl-lead">{t.lead}</p>
        {state === 'done' ? (
          <p className="note wl-done" role="status">{t.done}</p>
        ) : (
          <form className="wl-form" noValidate onSubmit={submit}>
            <div className="co-f">
              <label htmlFor={id + 'Email'}>{t.email}</label>
              <input className="field" id={id + 'Email'} name="wlEmail" type="email" inputMode="email" autoComplete="email" maxLength={254} required />
            </div>
            <div className="co-f">
              <label htmlFor={id + 'Area'}>{t.area}</label>
              <select className="field" id={id + 'Area'} name="wlArea" defaultValue="mainland">
                <option value="mainland">{t.mainland}</option><option value="madeira">{t.madeira}</option><option value="azores">{t.azores}</option><option value="other">{t.other}</option>
              </select>
            </div>
            <div className="co-check">
              <input type="checkbox" id={id + 'Consent'} name="wlConsent" />
              <label htmlFor={id + 'Consent'}>{t.consent(<Link to={to('privacy')}>{t.privacy}</Link>)}</label>
            </div>
            <button className="btn btn-primary" type="submit" disabled={state === 'sending'} aria-busy={state === 'sending' || undefined}>{state === 'sending' ? t.sending : t.send}</button>
            <p className="err wl-msg" role="alert" hidden={!msg}>{msg}</p>
          </form>
        )}
      </div>
    </section>
  );
}
