/* Transactional email through Resend's HTTP API (https://resend.com). RESEND_API_KEY is a Worker secret; MAIL_FROM is a plain var
   such as "OFS/T <no-reply@ofstdesigns.com>" whose domain must be verified in Resend (SPF/DKIM records). */
export interface MailEnv { RESEND_API_KEY: string; MAIL_FROM: string }

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

export async function sendMail(env: MailEnv, to: string, subject: string, html: string, text: string): Promise<void> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new Error('mail_not_configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html, text }),
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

export function paidEmail(lang: 'pt' | 'en', ref: string, totalCents: number, lines: { name: string; desc: string; qty: number }[]) {
  const c = COPY[lang];
  const money = new Intl.NumberFormat(lang === 'pt' ? 'pt-PT' : 'en-IE', { style: 'currency', currency: 'EUR' }).format(totalCents / 100);
  const rows = lines.map((l) => `<li style="margin:0 0 8px"><strong>${esc(l.name)}</strong> × ${l.qty}<br><span style="color:#555;font-size:13px">${esc(l.desc)}</span></li>`).join('');
  const html = shell(c.paidTitle, `<p style="margin:0 0 14px;line-height:1.5">${esc(c.paidBody.replace('{ref}', ref))}</p><ul style="padding-left:18px;margin:0 0 14px">${rows}</ul><p style="margin:0"><strong>${esc(c.total)}: ${esc(money)}</strong></p>`);
  const text = `${c.paidBody.replace('{ref}', ref)}\n\n${lines.map((l) => `- ${l.name} x ${l.qty} (${l.desc})`).join('\n')}\n\n${c.total}: ${money}`;
  return { subject: `${c.paidSubject} (${ref})`, html, text };
}
