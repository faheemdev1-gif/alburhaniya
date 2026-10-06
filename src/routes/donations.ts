import express from 'express';
import { createDonationCheckout, donationSessionStatus, donationConfigured, StripeCheckoutError, validDonationAmount } from '../services/stripeCheckout';
const router = express.Router();
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const buckets = new Map<string, { count: number; expires: number }>();
function limit(req: express.Request, res: express.Response, kind: string, maximum: number) {
  const now = Date.now();
  for (const [key, value] of buckets) if (value.expires <= now) buckets.delete(key);
  const key = `${kind}:${req.ip}`;
  const bucket = buckets.get(key) || { count: 0, expires: now + 15 * 60_000 };
  if (!buckets.has(key) && buckets.size >= 10000) { res.status(429).json({ message: 'Please wait before trying again.' }); return false; }
  buckets.set(key, bucket);
  if (++bucket.count <= maximum) return true;
  res.setHeader('Retry-After', '900'); res.status(429).json({ message: 'Too many checkout requests. Please wait 15 minutes before trying again.' }); return false;
}
function fail(res: express.Response, err: unknown) {
  res.status(err instanceof StripeCheckoutError ? err.status : 503).json({ message: err instanceof StripeCheckoutError ? err.message : 'Online donations are temporarily unavailable. Please try again.' });
}
router.post('/checkout', async (req, res) => {
  if (!req.is('application/json')) { res.status(415).json({ message: 'Send the donation amount as JSON.' }); return; }
  if (!validDonationAmount(req.body?.amountPence) || typeof req.body?.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.body.requestId)) {
    res.status(400).json({ message: 'Choose a donation between £1.00 and £10,000.00 with no more than two decimal places.' }); return;
  }
  if (!limit(req, res, 'checkout', 100)) return;
  if (!donationConfigured()) { res.status(503).json({ message: 'Online donations are not configured yet. Please try again later.' }); return; }
  try { res.json(await createDonationCheckout(req.body.amountPence, req.body.requestId)); } catch (err) { fail(res, err); }
});
router.get('/session/:id', async (req, res) => {
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(req.params.id)) { res.status(400).json({ message: 'Invalid payment session.' }); return; }
  if (!limit(req, res, 'status', 200)) return;
  try { res.json(await donationSessionStatus(req.params.id)); } catch (err) { fail(res, err); }
});
export default router;
