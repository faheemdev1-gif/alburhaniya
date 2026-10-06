export const MIN_DONATION_PENCE = 100;
export const MAX_DONATION_PENCE = 1_000_000;
export const DONATION_CONTRACT = 'donation-checkout-v1';
const stripeVersion = '2025-06-30.basil';
export function donationSiteUrl(): string {
  const url = new URL(process.env.DONATION_SITE_URL || 'https://al-burhaniyainternational.co.uk');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Invalid donation site URL');
  return url.origin;
}
export function donationConfigured(): boolean {
  try { donationSiteUrl(); return /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(process.env.STRIPE_SECRET_KEY || ''); } catch { return false; }
}
export const validDonationAmount = (amount: unknown): amount is number => typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= MIN_DONATION_PENCE && amount <= MAX_DONATION_PENCE;
export class StripeCheckoutError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function stripeRequest(path: string, method: 'GET' | 'POST', body?: URLSearchParams, idempotencyKey?: string) {
  if (!donationConfigured()) throw new StripeCheckoutError(503, 'Online donations are not configured yet. Please try again later.');
  try {
    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Stripe-Version': stripeVersion,
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      ...(body ? { body: body.toString() } : {}),
    });
    if (!response.ok) {
      if (response.status === 404 && method === 'GET') throw new StripeCheckoutError(404, 'This payment session could not be found.');
      if (response.status === 409 || (response.status === 400 && (await response.json()).error?.type === 'idempotency_error')) throw new StripeCheckoutError(409, 'This checkout attempt is already in progress. Please wait and try again.');
      throw new StripeCheckoutError(503, 'Secure checkout is temporarily unavailable. Please try again; your amount has been kept.');
    }
    return await response.json();
  } catch (err) {
    if (err instanceof StripeCheckoutError) throw err;
    throw new StripeCheckoutError(503, 'We could not reach secure checkout. Please try again; your amount has been kept.');
  }
}
export async function createDonationCheckout(amountPence: number, requestId: string) {
  const site = donationSiteUrl();
  const body = new URLSearchParams({ mode: 'payment', submit_type: 'donate',
    'line_items[0][price_data][currency]': 'gbp', 'line_items[0][price_data][unit_amount]': String(amountPence),
    'line_items[0][price_data][product_data][name]': 'Support Al-Burhaniya International', 'line_items[0][quantity]': '1',
    'payment_method_types[0]': 'card', 'adaptive_pricing[enabled]': 'false',
    'metadata[donation_contract]': DONATION_CONTRACT, 'metadata[amount_pence]': String(amountPence),
    'payment_intent_data[metadata][donation_contract]': DONATION_CONTRACT,
    client_reference_id: requestId, success_url: `${site}/donation/return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/donation/return?cancelled=1`,
  });
  const session = await stripeRequest('', 'POST', body, `donation-v1:${requestId}`);
  let url: URL;
  try { url = new URL(session.url); } catch { throw new StripeCheckoutError(503, 'Stripe did not return a valid checkout link. Please try again.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password || session.amount_total !== amountPence || session.currency !== 'gbp') {
    throw new StripeCheckoutError(503, 'Stripe did not return the expected donation amount. Please try again.');
  }
  return { url: url.href, amountPence };
}
export async function donationSessionStatus(id: string) {
  const session = await stripeRequest(`/${encodeURIComponent(id)}`, 'GET');
  if (session.metadata?.donation_contract !== DONATION_CONTRACT || session.mode !== 'payment' || session.currency !== 'gbp' ||
      !validDonationAmount(session.amount_total) || session.metadata.amount_pence !== String(session.amount_total)) {
    throw new StripeCheckoutError(404, 'This donation session could not be found.');
  }
  return { status: session.status === 'complete' && session.payment_status === 'paid' ? 'paid' : session.status === 'expired' ? 'expired' : 'pending', amountPence: session.amount_total };
}
