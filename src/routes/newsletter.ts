import express from 'express';
import { createHash } from 'crypto';
import mongoose from 'mongoose';
import Subscriber, { NEWSLETTER_STATUSES } from '../models/NewsletterSubscriber';
import { protect, adminOnly } from '../middleware/auth';
import { validEmail } from '../services/contactNotification';
import { newsletterEmailConfigured, sendNewsletterConfirmation, tokenHash, unsubscribeId, unsubscribeUrl } from '../services/newsletterNotification';

const router = express.Router();
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const buckets = new Map<string, { count: number; expires: number }>();
function allow(key: string, limit: number): boolean {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.expires <= now) buckets.delete(k);
  const bucket = buckets.get(key) || { count: 0, expires: now + 15 * 60_000 };
  if (!buckets.has(key) && buckets.size >= 10000) return false;
  buckets.set(key, bucket);
  return ++bucket.count <= limit;
}
function limited(req: express.Request, res: express.Response, email?: string): boolean {
  // Per-process limits; never trust client-supplied forwarding headers.
  if (!allow(`ip:${req.ip}`, 100) || (email && !allow(`email:${createHash('sha256').update(email).digest('hex')}`, 5))) {
    res.setHeader('Retry-After', '900'); res.status(429).json({ message: 'Too many requests. Please wait 15 minutes before trying again.' }); return true;
  }
  return false;
}
function receipt(res: express.Response, result: string) {
  if (result === 'disabled') return res.status(202).json({ confirmationAvailable: false, message: 'Your request has been saved. Email confirmation is currently unavailable; please try subscribing again later.' });
  if (result === 'failed') return res.status(503).json({ message: 'Your request is saved, but the confirmation email could not be sent. Please try again after one minute.' });
  return res.json({ confirmationAvailable: true, message: 'If confirmation is needed, check your inbox and spam folder for a confirmation link. You will join the mailing list after confirming.' });
}
router.post('/subscribe', async (req, res) => {
  if (!req.is('application/json')) { res.status(415).json({ message: 'Send the email address as JSON.' }); return; }
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!validEmail(email) || /[\x00-\x1f\x7f]/.test(email) || (req.body.website !== undefined && req.body.website !== '')) {
    res.status(400).json({ message: 'Enter a valid email address.' }); return;
  }
  if (limited(req, res, email)) return;
  try {
    let record;
    try {
      record = await Subscriber.findOneAndUpdate({ email }, { $setOnInsert: { email, status: 'pending', requestedAt: new Date(), consentVersion: 'homepage-newsletter-v1' } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      record = await Subscriber.findOne({ email });
    }
    if (!record) throw new Error('Missing subscriber');
    if (record.status === 'confirmed') { receipt(res, 'inactive'); return; }
    if (record.status === 'unsubscribed') {
      record = await Subscriber.findOneAndUpdate({ _id: record.id, status: 'unsubscribed' }, {
        $set: { status: 'pending', requestedAt: new Date(), notificationStatus: 'pending', consentVersion: 'homepage-newsletter-v1' },
        $unset: { confirmationHash: 1, confirmationExpiresAt: 1, confirmedAt: 1, notificationAttemptedAt: 1 },
      }, { new: true });
      if (!record) { receipt(res, 'inactive'); return; }
    }
    receipt(res, await sendNewsletterConfirmation(record.id));
  } catch { res.status(503).json({ message: 'The subscription could not be completed. Please try again; your email address has been kept.' }); }
});
router.post('/confirm', async (req, res) => {
  if (limited(req, res)) return;
  const token = req.body?.token;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) { res.status(400).json({ message: 'This confirmation link is invalid or expired. Subscribe again to request a new link.' }); return; }
  try {
    const hash = tokenHash(token);
    const record = await Subscriber.findOneAndUpdate({ confirmationHash: hash, status: 'pending', confirmationExpiresAt: { $gt: new Date() } }, {
      $set: { status: 'confirmed', confirmedAt: new Date() },
    }, { new: true });
    if (!record && !await Subscriber.exists({ confirmationHash: hash, status: 'confirmed' })) {
      res.status(400).json({ message: 'This confirmation link is invalid or expired. Subscribe again to request a new link.' }); return;
    }
    res.json({ message: 'Your newsletter subscription is confirmed. Thank you for joining us.' });
  } catch { res.status(503).json({ message: 'We could not confirm your subscription. Please try again.' }); }
});
router.post('/unsubscribe', async (req, res) => {
  if (limited(req, res)) return;
  const id = unsubscribeId(req.body?.token);
  if (!id) { res.status(400).json({ message: 'This unsubscribe link is invalid.' }); return; }
  try {
    await Subscriber.updateOne({ _id: id, status: { $ne: 'unsubscribed' } }, { $set: { status: 'unsubscribed', unsubscribedAt: new Date() }, $unset: { confirmationHash: 1, confirmationExpiresAt: 1 } });
    res.json({ message: 'You have been unsubscribed from the newsletter.' });
  } catch { res.status(503).json({ message: 'We could not unsubscribe you. Please try again.' }); }
});

router.use(protect, adminOnly);
// Export only confirmed consent. Escape formula prefixes as well as normal CSV quoting.
const csvCell = (value: string) => `"${(/^[=+@\-\t\r\n]/.test(value) ? "'" + value : value).replace(/"/g, '""')}"`;
router.get('/export', async (_req, res) => {
  try {
    const rows = await Subscriber.find({ status: 'confirmed' }).sort({ createdAt: -1 }).select('email confirmedAt').lean();
    const csv = ['email,confirmed_at,unsubscribe_url', ...rows.map(row => [row.email, row.confirmedAt?.toISOString() || '', unsubscribeUrl(String(row._id))].map(csvCell).join(','))].join('\r\n') + '\r\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="newsletter-subscribers.csv"');
    res.send(csv);
  } catch { res.status(503).json({ message: 'Subscribers could not be exported. Check the backend newsletter settings and try again.' }); }
});
router.get('/', async (req, res) => {
  const status = req.query.status || 'all', page = Number(req.query.page || 1);
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  if (typeof status !== 'string' || (status !== 'all' && !NEWSLETTER_STATUSES.includes(status)) || !Number.isSafeInteger(page) || page < 1 || page > 100000 || search.length > 254 || (req.query.search !== undefined && typeof req.query.search !== 'string')) {
    res.status(400).json({ message: 'Invalid subscriber filters.' }); return;
  }
  const filter = { ...(status !== 'all' ? { status } : {}), ...(search ? { email: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } } : {}) };
  try {
    const [subscribers, total] = await Promise.all([
      Subscriber.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 25).limit(25).select('-confirmationHash -confirmationExpiresAt').lean(), Subscriber.countDocuments(filter),
    ]);
    res.json({ subscribers, total, page, pageSize: 25, emailConfigured: newsletterEmailConfigured() });
  } catch { res.status(503).json({ message: 'Subscribers could not be loaded. Please try again.' }); }
});
router.post('/:id/resend', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ message: 'Invalid subscriber.' }); return; }
  try {
    const record = await Subscriber.findById(req.params.id);
    if (!record) { res.status(404).json({ message: 'Subscriber not found.' }); return; }
    if (record.status !== 'pending') { res.status(409).json({ message: 'Only pending subscribers need a confirmation email.' }); return; }
    receipt(res, await sendNewsletterConfirmation(record.id));
  } catch { res.status(503).json({ message: 'Confirmation could not be sent. The request is still saved.' }); }
});
router.post('/:id/unsubscribe', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ message: 'Invalid subscriber.' }); return; }
  try {
    const record = await Subscriber.findByIdAndUpdate(req.params.id, { $set: { status: 'unsubscribed', unsubscribedAt: new Date() }, $unset: { confirmationHash: 1, confirmationExpiresAt: 1 } }, { new: true });
    if (!record) { res.status(404).json({ message: 'Subscriber not found.' }); return; }
    res.json({ message: 'Subscriber removed from the mailing list.' });
  } catch { res.status(503).json({ message: 'The subscriber could not be updated.' }); }
});
export default router;
