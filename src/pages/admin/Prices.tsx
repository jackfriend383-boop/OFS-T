/* Admin "Prices" tab: every price the shop charges that can change over time, in one place.
   - Full kit price per design (also in the Designs tab) - whole euros.
   - Price of each PAIR of pieces: door, window, Ami OG front accents (one for each side of the car).
   - The custom badge extra.
   - Shipping (0 = free) and the order value from which shipping is free (0 = never).
   The shop's server (worker/src/prices.ts + designs.ts) checks every number again and is the only thing that decides what Stripe charges;
   the cart and configurator show the same list. The full kit is never charged more than its own pieces added up (kitPrice in lib/kit.ts). */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useApp } from '../../state';
import DATA from '../../data/designs.json';
import { cleanRemotePrices, fullPieces, setRemotePrices, type RemotePrices } from '../../lib/kit';

const BUILTIN = DATA.designs as { id: string; name: string; price: number }[];
type Key = keyof RemotePrices;
const KEYS: Key[] = ['door', 'window', 'accent', 'badge', 'shipping', 'freeFrom'];
const DEFAULTS: Record<Key, number> = { door: DATA.pieces.door, window: DATA.pieces.window, accent: DATA.pieces.accent, badge: DATA.extras.badge, shipping: (DATA as any).shipping?.fee ?? 0, freeFrom: (DATA as any).shipping?.freeFrom ?? 0 };

const TXT = {
  en: {
    title: 'Prices & shipping', note: 'Everything the shop charges. Changes apply to the shop and to checkout as soon as you save (visitors see them on their next page load). Pieces are always sold as a pair: one for each side of the car.',
    kits: 'Full kit (per design)', kitsNote: 'Both sides of the car: door pair + window pair, plus the front accent pair on the Ami OG.', kitCol: 'Full kit price (€)',
    pieces: 'Single pieces (price per pair)', door: 'Door stickers (pair)', window: 'Window stickers (pair)', accent: 'Front accents (pair, Ami OG only)',
    extras: 'Extras', badge: 'Custom badge text (extra)', badgeNote: 'Only charged on an order that has badge text; the configurator does not offer it at the moment.',
    ship: 'Shipping', shipping: 'Shipping cost per order (€)', shipHint: '0 = free delivery.', freeFrom: 'Free shipping from an order of (€)', freeHint: '0 = no free-shipping threshold.',
    check: 'Check', model: { qs: 'Ami 2025', pop: 'Ami OG' }, parts: 'Pieces separately', kit: 'Full kit', charged: 'Customer pays for the full kit',
    okLine: 'The full kit is cheaper than or equal to its pieces.',
    badLine: (kit: string, parts: string) => `The full kit (${kit}) costs more than its pieces added up (${parts}). The shop charges ${parts} for the full kit so splitting the kit never saves money. Lower the kit price or raise the pieces.`,
    shipNow: (s: string) => `Customers currently see: ${s}`,
    save: 'Save prices', saving: 'Saving…', saved: 'Saved.', failed: 'That did not work. Check the numbers and try again.', needDeploy: 'The shop server does not have the prices feature yet (deploy the Worker and run the 0011 migration).',
    reset: 'Back to the site defaults', confirmReset: 'Put every price in this tab back to the site defaults (pieces, badge, shipping)? Full kit prices are not changed.', loading: 'Loading prices…', euro: '€',
    badInput: 'Every price must be a number. Pieces and the badge need at least 1 €, kits a whole number between 1 and 999.',
  },
  pt: {
    title: 'Preços e portes', note: 'Tudo o que a loja cobra. As alterações aplicam-se à loja e ao pagamento assim que guardares (os visitantes veem-nas na página seguinte que abrirem). As peças são sempre vendidas aos pares: uma para cada lado do carro.',
    kits: 'Kit completo (por design)', kitsNote: 'Os dois lados do carro: par de portas + par de vidros, e no Ami OG também o par de acentos frontais.', kitCol: 'Preço do kit completo (€)',
    pieces: 'Peças individuais (preço por par)', door: 'Autocolantes de porta (par)', window: 'Autocolantes de vidro (par)', accent: 'Acentos frontais (par, só Ami OG)',
    extras: 'Extras', badge: 'Texto personalizado no emblema (extra)', badgeNote: 'Só é cobrado numa encomenda com texto no emblema; o configurador não o oferece neste momento.',
    ship: 'Portes', shipping: 'Portes por encomenda (€)', shipHint: '0 = entrega grátis.', freeFrom: 'Portes grátis a partir de uma encomenda de (€)', freeHint: '0 = sem valor mínimo para portes grátis.',
    check: 'Verificação', model: { qs: 'Ami 2025', pop: 'Ami OG' }, parts: 'Peças em separado', kit: 'Kit completo', charged: 'O cliente paga pelo kit completo',
    okLine: 'O kit completo custa o mesmo ou menos do que as peças em separado.',
    badLine: (kit: string, parts: string) => `O kit completo (${kit}) custa mais do que as peças somadas (${parts}). A loja cobra ${parts} pelo kit completo para que dividir o kit nunca poupe dinheiro. Baixa o preço do kit ou sobe o das peças.`,
    shipNow: (s: string) => `Os clientes veem agora: ${s}`,
    save: 'Guardar preços', saving: 'A guardar…', saved: 'Guardado.', failed: 'Não funcionou. Verifica os números e tenta de novo.', needDeploy: 'O servidor da loja ainda não tem os preços editáveis (faz o deploy do Worker e executa a migração 0011).',
    reset: 'Repor valores do site', confirmReset: 'Repor todos os preços deste separador para os valores do site (peças, emblema, portes)? Os preços dos kits completos não mudam.', loading: 'A carregar preços…', euro: '€',
    badInput: 'Todos os preços têm de ser números. As peças e o emblema precisam de pelo menos 1 €, os kits de um número inteiro entre 1 e 999.',
  },
};

const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));
const fmtIn = (v: number) => String(v).replace('.', ',');

export default function Prices() {
  const { backend, lang, kit } = useApp();
  const t = TXT[lang === 'pt' ? 'pt' : 'en'];
  const [vals, setVals] = useState<Record<Key, string> | null>(null);
  const [kits, setKits] = useState<Record<string, string>>({}); // design id -> price text
  const [names, setNames] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await backend.getPrices();
      const out = {} as Record<Key, string>;
      for (const k of KEYS) out[k] = fmtIn(typeof p[k] === 'number' ? p[k] : DEFAULTS[k]);
      setVals(out); setMsg('');
    } catch (e: any) {
      const out = {} as Record<Key, string>;
      for (const k of KEYS) out[k] = fmtIn(DEFAULTS[k]);
      setVals(out); setMsg(t.needDeploy);
    }
    try {
      const list = (await backend.listDesigns()) as { id: string; name: string | null; price: number | null; custom: boolean }[];
      const rows = [
        ...BUILTIN.map((b) => { const r = list.find((x) => x.id === b.id); return { id: b.id, name: r?.name ?? b.name, price: r?.price ?? b.price }; }),
        ...list.filter((r) => r.custom && r.name && r.price).map((r) => ({ id: r.id, name: r.name as string, price: r.price as number })),
      ];
      setKits(Object.fromEntries(rows.map((r) => [r.id, String(r.price)]))); setNames(Object.fromEntries(rows.map((r) => [r.id, r.name])));
    } catch {
      setKits(Object.fromEntries(BUILTIN.map((b) => [b.id, String(b.price)]))); setNames(Object.fromEntries(BUILTIN.map((b) => [b.id, b.name])));
    }
  }, [backend, t.needDeploy]);
  useEffect(() => { void load(); }, [load]);

  const parsed = useMemo(() => {
    const o = {} as Record<Key, number>;
    if (!vals) return o;
    for (const k of KEYS) o[k] = num(vals[k]);
    return o;
  }, [vals]);
  const euro = kit.money;
  const partsOf = (m: 'qs' | 'pop') => fullPieces(m).reduce((s, p) => s + (parsed[p as 'door'] || 0), 0);

  const set = (k: Key, v: string) => setVals((x) => x && { ...x, [k]: v });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!vals || busy) return;
    const body: Record<string, number | null> = {};
    for (const k of KEYS) {
      const n = parsed[k], min = k === 'shipping' || k === 'freeFrom' ? 0 : 1;
      if (!Number.isFinite(n) || n < min) { setMsg(t.badInput); return; }
      body[k] = Math.round(n * 100) / 100;
    }
    const kitBody: [string, number][] = [];
    for (const id of Object.keys(kits)) {
      const n = Number(kits[id]);
      if (!Number.isInteger(n) || n < 1 || n > 999) { setMsg(t.badInput); return; }
      kitBody.push([id, n]);
    }
    setBusy(true); setMsg(t.saving);
    try {
      const p = await backend.savePrices(body);
      for (const [id, n] of kitBody) await backend.saveDesign(id, { price: n });
      setRemotePrices(cleanRemotePrices(p));
      setMsg(t.saved);
      await load();
    } catch (err: any) { setMsg(err && (err.code === 'not_found' || err.status === 404) ? t.needDeploy : t.failed); }
    setBusy(false);
  }
  async function reset() {
    if (busy || !confirm(t.confirmReset)) return;
    setBusy(true); setMsg(t.saving);
    try {
      const p = await backend.savePrices(Object.fromEntries(KEYS.map((k) => [k, null])));
      setRemotePrices(cleanRemotePrices(p));
      setMsg(t.saved); await load();
    } catch { setMsg(t.failed); }
    setBusy(false);
  }

  const field = (k: Key, label: string, hint?: string) => (
    <div className="co-f" key={k}>
      <label htmlFor={'pr_' + k}>{label}</label>
      <input className="field" id={'pr_' + k} inputMode="decimal" value={vals ? vals[k] : ''} onChange={(e) => set(k, e.target.value)} />
      {hint && <span className="adm-note">{hint}</span>}
    </div>
  );

  const shipPreview = Number.isFinite(parsed.shipping) && Number.isFinite(parsed.freeFrom)
    ? (parsed.shipping <= 0 ? kit.T('shipFreeLine') : parsed.freeFrom > 0 ? kit.T('shipFeeFromLine', { fee: euro(parsed.shipping), from: euro(parsed.freeFrom) }) : kit.T('shipFeeLine', { fee: euro(parsed.shipping) }))
    : '';

  return (
    <section className="adm-tool adm-prices" aria-labelledby="admPricesTitle">
      <h2 id="admPricesTitle">{t.title}</h2>
      <p className="adm-note">{t.note}</p>
      {!vals && <p className="adm-empty">{t.loading}</p>}
      {vals && (
        <form className="adm-panel pr-form" onSubmit={save} noValidate>
          <h3>{t.kits}</h3>
          <p className="adm-note">{t.kitsNote}</p>
          <div className="pr-grid">
            {Object.keys(kits).map((id) => (
              <div className="co-f" key={id}>
                <label htmlFor={'pk_' + id}>{names[id] || id}: {t.kitCol}</label>
                <input className="field" id={'pk_' + id} type="number" min={1} max={999} step={1} inputMode="numeric" value={kits[id]} onChange={(e) => setKits((x) => ({ ...x, [id]: e.target.value }))} />
              </div>
            ))}
          </div>

          <h3>{t.pieces}</h3>
          <div className="pr-grid">{field('door', t.door)}{field('window', t.window)}{field('accent', t.accent)}</div>

          <h3>{t.extras}</h3>
          <div className="pr-grid">{field('badge', t.badge, t.badgeNote)}</div>

          <h3>{t.ship}</h3>
          <div className="pr-grid">{field('shipping', t.shipping, t.shipHint)}{field('freeFrom', t.freeFrom, t.freeHint)}</div>
          {shipPreview && <p className="adm-note">{t.shipNow(shipPreview)}</p>}

          <h3>{t.check}</h3>
          <ul className="pr-check">
            {(['qs', 'pop'] as const).map((m) => {
              const parts = partsOf(m);
              return (
                <li key={m}>
                  <b>{t.model[m]}</b>
                  {Object.keys(kits).map((id) => {
                    const kp = Number(kits[id]), over = Number.isFinite(kp) && Number.isFinite(parts) && kp > parts;
                    return <p className={over ? 'err' : 'adm-note'} key={id}>
                      {names[id] || id}: {t.kit} {euro(kp)} · {t.parts} {euro(parts)} · {over ? t.badLine(euro(kp), euro(parts)) : t.okLine}
                    </p>;
                  })}
                </li>
              );
            })}
          </ul>

          <div className="adm-bar">
            <button className="btn btn-primary" type="submit" disabled={busy}>{t.save}</button>
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={reset}>{t.reset}</button>
          </div>
        </form>
      )}
      <p className="adm-note" role="status" aria-live="polite">{msg}</p>
    </section>
  );
}
