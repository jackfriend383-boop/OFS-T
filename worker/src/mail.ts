/* Transactional email through Resend's HTTP API (https://resend.com). RESEND_API_KEY is a Worker secret; MAIL_FROM is a plain var
   such as "OFS/T <no-reply@ofstdesigns.com>" whose domain must be verified in Resend (SPF/DKIM records). */
export interface MailEnv { RESEND_API_KEY: string; MAIL_FROM: string }
export interface MailAttachment { filename: string; content: string; content_type?: string }

import SITE from '../../src/data/site.json';

/* Seller details from src/data/site.json; values still in [BRACKETS] are placeholders and are left out of emails. */
const real = (v: unknown) => (typeof v === 'string' && v.trim() && !/^\[.*\]$/.test(v.trim()) ? v.trim() : '');
const S = SITE as any;
export const CONTACT = real(S.email) || 'geral@ofstdesigns.com';
const SITE_URL = (real(S.SITE_URL) || 'https://ofstdesigns.com').replace(/\/$/, '');
const sellerLine = () => {
  const a = S.address || {};
  const parts = [real(S.legalName), real(S.nif) && `NIF ${real(S.nif)}`, [real(a.street), [real(a.postcode), real(a.city)].filter(Boolean).join(' '), real(a.country)].filter(Boolean).join(', ')].filter(Boolean);
  return parts.join(' · ');
};

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* A small, mobile-friendly HTML shell in the site's look: light grey page, white rounded card, OFS/T logo, black button.
   `body` must already be escaped. The logo is a PNG on the site (many email apps block SVG). */
const LOGO = 'https://ofstdesigns.com/assets/img/email-logo.png';
const FONT = "'Inter Tight','Helvetica Neue',Helvetica,Arial,sans-serif";
function shell(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#eeeff2;font-family:${FONT};color:#0e0f12">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border-radius:22px;padding:32px">
<tr><td><p style="margin:0 0 22px"><img src="${LOGO}" width="40" height="40" alt="OFS/T" style="display:block;border:0"></p>
<h1 style="margin:0 0 14px;font-size:24px;font-weight:600;letter-spacing:-.01em;line-height:1.2">${esc(title)}</h1>${body}
<p style="margin:26px 0 0;padding-top:16px;border-top:1px solid #e2e3e7;color:#8e8f96;font-size:12px">OFS/T · ofstdesigns.com</p></td></tr></table></td></tr></table></body></html>`;
}
const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="background:#0e0f12;color:#ffffff;text-decoration:none;font-weight:500;padding:14px 24px;border-radius:12px;display:inline-block">${esc(label)}</a></p>`;

export async function sendMail(env: MailEnv, to: string, subject: string, html: string, text: string, attachments?: MailAttachment[]): Promise<void> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new Error('mail_not_configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    // Replies go to the shop's real inbox, not to the no-reply sender.
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], reply_to: CONTACT, subject, html, text, ...(attachments?.length ? { attachments } : {}) }),
  });
  if (!res.ok) { console.error('resend failed', res.status); throw new Error('mail_failed'); }
}

const COPY = {
  pt: {
    linkSubject: 'O seu link de acesso OFS/T', linkTitle: 'Entrar na sua conta', linkBody: 'Clique no botão para entrar. O link é válido durante 15 minutos e só pode ser usado uma vez.',
    linkButton: 'Entrar', linkIgnore: 'Se não pediu este email, pode ignorá-lo: ninguém entra na sua conta sem este link.',
    paidSubject: 'Recebemos o seu pagamento', paidTitle: 'Obrigado pela sua encomenda', paidBody: 'Recebemos o pagamento da encomenda {ref}. Enviaremos um email quando o kit seguir.', total: 'Total',
  },
  en: {
    linkSubject: 'Your OFS/T sign-in link', linkTitle: 'Sign in to your account', linkBody: 'Click the button to sign in. The link works for 15 minutes and can be used once.',
    linkButton: 'Sign in', linkIgnore: "If you didn't request this email you can ignore it: nobody can get into your account without this link.",
    paidSubject: "We've received your payment", paidTitle: 'Thank you for your order', paidBody: "We've received payment for order {ref}. We'll email you when your kit ships.", total: 'Total',
  },
} as const;

export function signInEmail(lang: 'pt' | 'en', link: string) {
  const c = COPY[lang];
  const html = shell(c.linkTitle, `<p style="margin:0;line-height:1.5">${esc(c.linkBody)}</p>${button(link, c.linkButton)}<p style="margin:0;color:#555;font-size:13px;line-height:1.5">${esc(c.linkIgnore)}</p>`);
  return { subject: c.linkSubject, html, text: `${c.linkBody}\n\n${link}\n\n${c.linkIgnore}` };
}

/* Legal information every payment confirmation must carry (DL 24/2014 art. 6.º: confirmation on a durable medium). */
/* No VAT is charged: the seller uses the small-business exemption (art. 53.º CIVA). */
export const VAT_NOTE = { pt: 'IVA não aplicável – regime de isenção (art. 53.º do CIVA).', en: 'VAT not applicable – exemption under art. 53 of the Portuguese VAT Code (CIVA).' };

const LEGAL = {
  pt: (pers: boolean) => [
    ['Direito de livre resolução', `Pode resolver o contrato no prazo de 14 dias a contar da receção do kit, sem indicar motivo, enviando-nos uma declaração inequívoca (por exemplo para ${CONTACT}) ou o modelo de formulário em ${SITE_URL}/refunds/#form.${pers ? ' Exceção: os artigos com texto escolhido por si no emblema foram feitos segundo as suas especificações e não têm direito de livre resolução (DL 24/2014, art. 17.º, n.º 1, al. c)), conforme aceitou na finalização da compra.' : ''}`],
    ['Garantia legal', '3 anos a contar da entrega (Decreto-Lei n.º 84/2021).'],
    ['Condições de venda', `Em vigor à data da encomenda: ${SITE_URL}/terms/ · Reembolsos e devoluções: ${SITE_URL}/refunds/`],
    ['Reclamações', 'Livro de Reclamações Eletrónico: www.livroreclamacoes.pt · Resolução alternativa de litígios: CIMARA (Açores), www.ocimara.pt · CNIACC, www.cniacc.pt'],
  ],
  en: (pers: boolean) => [
    ['Right of withdrawal', `You can withdraw from the contract within 14 days of receiving the kit, without giving a reason, by sending us a clear statement (for example to ${CONTACT}) or the model form at ${SITE_URL}/en/refunds/#form.${pers ? ' Exception: items with badge text you chose were made to your specification and have no right of withdrawal (Decree-Law 24/2014, art. 17(1)(c)), as you accepted at checkout.' : ''}`],
    ['Legal guarantee', '3 years from delivery (Decree-Law 84/2021).'],
    ['Terms of sale', `In force on the order date: ${SITE_URL}/en/terms/ · Refunds and returns: ${SITE_URL}/en/refunds/`],
    ['Complaints', 'Electronic Complaints Book (Livro de Reclamações): www.livroreclamacoes.pt · Alternative dispute resolution: CIMARA (Azores), www.ocimara.pt · CNIACC, www.cniacc.pt'],
  ],
};

export interface PaidOrder { ref: string; totalCents: number; lines: { name: string; desc: string; qty: number }[]; personalised: boolean;
  customer: { name?: string; street?: string; postcode?: string; city?: string; country?: string; nif?: string } }

export function paidEmail(lang: 'pt' | 'en', o: PaidOrder) {
  const c = COPY[lang];
  const money = new Intl.NumberFormat(lang === 'pt' ? 'pt-PT' : 'en-IE', { style: 'currency', currency: 'EUR' }).format(o.totalCents / 100);
  const rows = o.lines.map((l) => `<li style="margin:0 0 8px"><strong>${esc(l.name)}</strong> × ${l.qty}<br><span style="color:#555;font-size:13px">${esc(l.desc)}</span></li>`).join('');
  const cu = o.customer || {};
  const addr = [cu.name, cu.street, [cu.postcode, cu.city].filter(Boolean).join(' '), cu.country].filter(Boolean).join(', ');
  const L = lang === 'pt' ? { ship: 'Morada de entrega', nif: 'NIF', seller: 'Vendedor', contact: 'Contacto' } : { ship: 'Delivery address', nif: 'NIF', seller: 'Seller', contact: 'Contact' };
  const seller = sellerLine();
  const legal = LEGAL[lang](o.personalised);
  const small = (t: string) => `<p style="margin:0 0 10px;color:#555;font-size:13px;line-height:1.5">${t}</p>`;
  const html = shell(c.paidTitle,
    `<p style="margin:0 0 14px;line-height:1.5">${esc(c.paidBody.replace('{ref}', o.ref))}</p><ul style="padding-left:18px;margin:0 0 14px">${rows}</ul>`
    + `<p style="margin:0 0 4px"><strong>${esc(c.total)}: ${esc(money)}</strong></p><p style="margin:0 0 18px;color:#555;font-size:13px">${esc(VAT_NOTE[lang])}</p>`
    + (addr ? small(`<strong>${L.ship}:</strong> ${esc(addr)}${cu.nif ? ` · ${L.nif} ${esc(cu.nif)}` : ''}`) : '')
    + `<div style="margin:18px 0 0;padding-top:14px;border-top:1px solid #e2e3e7">`
    + (seller ? small(`<strong>${L.seller}:</strong> ${esc(seller)}`) : '')
    + small(`<strong>${L.contact}:</strong> ${esc(CONTACT)}`)
    + legal.map(([h, t]) => small(`<strong>${esc(h)}:</strong> ${esc(t)}`)).join('') + `</div>`);
  const text = [c.paidBody.replace('{ref}', o.ref), '', ...o.lines.map((l) => `- ${l.name} x ${l.qty} (${l.desc})`), '', `${c.total}: ${money}`, VAT_NOTE[lang],
    addr ? `${L.ship}: ${addr}${cu.nif ? ` · NIF ${cu.nif}` : ''}` : '', '', seller ? `${L.seller}: ${seller}` : '', `${L.contact}: ${CONTACT}`,
    ...legal.map(([h, t]) => `${h}: ${t}`)].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
  return { subject: `${c.paidSubject} (${o.ref})`, html, text };
}

/* Sent when the shop marks an order as shipped in the admin. */
export function shippedEmail(lang: 'pt' | 'en', ref: string) {
  const c = lang === 'pt'
    ? { subject: `A sua encomenda seguiu (${ref})`, title: 'O seu kit está a caminho', body: `A encomenda ${ref} foi expedida. Quando a receber, siga o guia de aplicação incluído. Alguma dúvida? Responda a este email.` }
    : { subject: `Your order has shipped (${ref})`, title: 'Your kit is on its way', body: `Order ${ref} has been shipped. When it arrives, follow the fitting guide in the box. Any questions? Just reply to this email.` };
  return { subject: c.subject, html: shell(c.title, `<p style="margin:0;line-height:1.5">${esc(c.body)}</p>`), text: c.body };
}

/* Internal: tells the shop a new order was paid, so production can start the same day. */
export function newOrderEmail(o: PaidOrder & { adminUrl: string }) {
  const money = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(o.totalCents / 100);
  const where = [o.customer?.name, o.customer?.city, o.customer?.country].filter(Boolean).join(', ');
  const rows = o.lines.map((l) => `<li style="margin:0 0 6px"><strong>${esc(l.name)}</strong> × ${l.qty}<br><span style="color:#555;font-size:13px">${esc(l.desc)}</span></li>`).join('');
  const body = `<p style="margin:0 0 12px;line-height:1.5">${esc(where)}${o.personalised ? ' · <strong>personalizado</strong>' : ''}</p><ul style="padding-left:18px;margin:0 0 14px">${rows}</ul><p style="margin:0"><strong>Total: ${esc(money)}</strong></p>${button(o.adminUrl, 'Abrir a administração')}`;
  const text = `Nova encomenda ${o.ref} – ${money}\n${where}\n\n${o.lines.map((l) => `- ${l.name} x ${l.qty} (${l.desc})`).join('\n')}\n\n${o.adminUrl}`;
  return { subject: `Nova encomenda ${o.ref} – ${money}`, html: shell(`Nova encomenda ${o.ref}`, body), text };
}

export function invoiceEmail(lang: 'pt' | 'en', ref: string, totalCents: number, lines: { name: string; desc: string; qty: number }[]) {
  const c = lang === 'pt'
    ? { subject: `A sua fatura OFS/T (${ref})`, title: 'A sua fatura', body: `Segue em anexo a fatura da encomenda ${ref}.`, total: 'Total', footer: `Em caso de dúvida, responda a este email ou escreva para ${CONTACT}.` }
    : { subject: `Your OFS/T invoice (${ref})`, title: 'Your invoice', body: `Attached is the invoice for order ${ref}.`, total: 'Total', footer: `Any questions? Reply to this email or write to ${CONTACT}.` };
  const money = new Intl.NumberFormat(lang === 'pt' ? 'pt-PT' : 'en-IE', { style: 'currency', currency: 'EUR' }).format(totalCents / 100);
  const rows = lines.map((l) => `<li style="margin:0 0 8px"><strong>${esc(l.name)}</strong> × ${l.qty}<br><span style="color:#555;font-size:13px">${esc(l.desc)}</span></li>`).join('');
  const html = shell(c.title, `<p style="margin:0 0 14px;line-height:1.5">${esc(c.body)}</p><ul style="padding-left:18px;margin:0 0 14px">${rows}</ul><p style="margin:0 0 4px"><strong>${esc(c.total)}: ${esc(money)}</strong></p><p style="margin:0 0 14px;color:#555;font-size:13px">${esc(VAT_NOTE[lang])}</p><p style="margin:0;color:#555;font-size:13px;line-height:1.5">${esc(c.footer)}</p>`);
  const text = `${c.body}\n\n${lines.map((l) => `- ${l.name} x ${l.qty} (${l.desc})`).join('\n')}\n\n${c.total}: ${money}\n${VAT_NOTE[lang]}\n\n${c.footer}`;
  return { subject: c.subject, html, text };
}

/* Internal: a refund or dispute was reported by Stripe for an order. */
export function adminAlertEmail(ref: string, note: string) {
  const subject = `Encomenda ${ref}: ${note.split('.')[0]}`.slice(0, 150);
  return { subject, html: shell(`Encomenda ${ref}`, `<p style="margin:0;line-height:1.5">${esc(note)}</p>${button('https://admin.ofstdesigns.com/', 'Abrir a administração')}`), text: `${note}\n\nhttps://admin.ofstdesigns.com/` };
}
