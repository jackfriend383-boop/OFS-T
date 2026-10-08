/* Minimal Stripe client for Workers (plain fetch, no SDK): create a hosted Checkout Session and verify webhook signatures.
   The secret key and webhook secret are Worker secrets (wrangler secret put), never in git or in the browser. */
import type { PricedItem } from './pricing';

const API = 'https://api.stripe.com/v1';

export interface CheckoutParams {
  secretKey: string;
  orderId: string;
  email: string;
  items: PricedItem[];
  successUrl: string;
  cancelUrl: string;
  locale: 'pt' | 'en';
}

/* Creates a Checkout Session; returns its id and the Stripe-hosted URL the customer is sent to. */
export async function createCheckoutSession(p: CheckoutParams): Promise<{ id: string; url: string }> {
  const f = new URLSearchParams();
  f.set('mode', 'payment');
  f.set('success_url', p.successUrl);
  f.set('cancel_url', p.cancelUrl);
  f.set('client_reference_id', p.orderId);
  f.set('customer_email', p.email);
  f.set('locale', p.locale);
  f.set('metadata[order_id]', p.orderId);
  f.set('payment_intent_data[metadata][order_id]', p.orderId);
  f.set('expires_at', String(Math.floor(Date.now() / 1000) + 31 * 60)); // Stripe minimum is 30 minutes
  p.items.forEach((i, n) => {
    f.set(`line_items[${n}][quantity]`, String(i.qty));
    f.set(`line_items[${n}][price_data][currency]`, 'eur');
    f.set(`line_items[${n}][price_data][unit_amount]`, String(i.unit_cents));
    f.set(`line_items[${n}][price_data][product_data][name]`, i.name.slice(0, 250));
    f.set(`line_items[${n}][price_data][product_data][description]`, i.desc.slice(0, 500));
  });
  const res = await fetch(`${API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${p.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': p.orderId,
    },
    body: f,
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data.id !== 'string' || typeof data.url !== 'string') {
    console.error('stripe checkout failed', res.status, data && data.error && data.error.type, data && data.error && data.error.code);
    throw new Error('stripe_error');
  }
  return { id: data.id, url: data.url };
}

/* Closes a Checkout Session the customer walked away from, so it can no longer be paid. Returns the session's status afterwards
   ('expired', 'complete' or 'open'), or null if Stripe could not be reached. A session that was already paid cannot be expired;
   then Stripe answers with an error and we look the session up instead. */
export async function expireCheckoutSession(secretKey: string, sessionId: string): Promise<string | null> {
  const url = `${API}/checkout/sessions/${encodeURIComponent(sessionId)}`;
  const auth = { Authorization: `Bearer ${secretKey}` };
  try {
    const res = await fetch(`${url}/expire`, { method: 'POST', headers: auth });
    const data: any = await res.json().catch(() => null);
    if (res.ok && data && typeof data.status === 'string') return data.status;
    const look = await fetch(url, { headers: auth });
    const s: any = await look.json().catch(() => null);
    return look.ok && s && typeof s.status === 'string' ? s.status : null;
  } catch { return null; }
}

const enc = new TextEncoder();
const unhex = (s: string) => new Uint8Array((s.match(/../g) || []).map((h) => parseInt(h, 16)));

/* Verifies the `Stripe-Signature` header (t=timestamp,v1=hmac-sha256 of "t.body") in constant time, with a 5 minute tolerance. */
export async function verifyWebhook(body: string, header: string | null, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(',').map((s) => s.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k, v]) => k === 'v1' && /^[0-9a-f]{64}$/i.test(v || '')).map(([, v]) => v);
  if (!t || !/^\d{9,12}$/.test(t) || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  for (const s of sigs) if (await crypto.subtle.verify('HMAC', key, unhex(s), enc.encode(`${t}.${body}`))) return true;
  return false;
}
