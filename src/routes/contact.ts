import express from 'express';
import mongoose from 'mongoose';
import { createHash } from 'crypto';
import ContactMessage, { CONTACT_INTERESTS, CONTACT_STATUSES } from '../models/ContactMessage';
import { protect, adminOnly } from '../middleware/auth';
import { contactEmailConfigured, notifyContact, validEmail } from '../services/contactNotification';

const router = express.Router();
const windowMs = 15 * 60_000;
const buckets = new Map<string, { count: number; expires: number }>();
function allow(key: string, limit: number) {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.expires <= now) buckets.delete(k);
  const old = buckets.get(key);
  if (!old && buckets.size >= 10000) return false;
  const bucket = old || { count: 0, expires: now + windowMs };
  buckets.set(key, bucket);
  return ++bucket.count <= limit;
}
const publicReceipt = (res: express.Response, status = 201) => res.status(status).json({ message: 'Thank you. Your message has been received.' });

router.post('/', express.json({ limit: '16kb' }), async (req, res) => {
  if (!req.is('application/json')) { res.status(415).json({ message: 'Send the contact form as JSON.' }); return; }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) { res.status(400).json({ message: 'Invalid contact form.' }); return; }
  const text = (name: string) => typeof body[name] === 'string' ? body[name].trim() : '';
  const firstName = text('firstName'), lastName = text('lastName'), email = text('email').toLowerCase();
  const interest = text('interest'), message = text('message'), submissionId = text('submissionId');
  if (!firstName || firstName.length > 80 || /[\r\n\x00-\x1f]/.test(firstName) || !lastName || lastName.length > 80 || /[\r\n\x00-\x1f]/.test(lastName) ||
      !validEmail(email) || !CONTACT_INTERESTS.includes(interest) || !message || message.length > 5000 || message.includes('\0') ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId) ||
      (body.website !== undefined && body.website !== '')) {
    res.status(400).json({ message: 'Check your name, email, interest and message (maximum 5,000 characters).' }); return;
  }
  // Do not trust user-supplied forwarding headers. Limits are per process and reset on restart.
  const senderKey = createHash('sha256').update(email).digest('hex');
  if (!allow(`ip:${req.ip}`, 100) || !allow(`sender:${senderKey}`, 5)) {
    res.setHeader('Retry-After', '900'); res.status(429).json({ message: 'Too many messages. Please wait 15 minutes before trying again.' }); return;
  }
  const data = { submissionId, firstName, lastName, email, interest, message };
  let record;
  try {
    record = await ContactMessage.create(data);
  } catch (err: any) {
    if (err?.code === 11000) {
      try {
        const existing = await ContactMessage.findOne({ submissionId });
        if (existing && Object.entries(data).every(([key, value]) => existing.get(key) === value)) { publicReceipt(res, 200); return; }
        res.status(409).json({ message: 'This submission was already used. Refresh the page to send a new message.' }); return;
      } catch { /* Return the same safe storage error below. */ }
    }
    res.status(503).json({ message: 'Your message could not be saved. Please try again; your form has been kept.' }); return;
  }
  try { await notifyContact(record.id); }
  catch { console.error('[Contact] Notification status could not be updated; message is saved.'); }
  publicReceipt(res);
});

router.use(protect, adminOnly);
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
router.get('/', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'all';
  const page = Number(req.query.page || 1);
  if ((status !== 'all' && !CONTACT_STATUSES.includes(status)) || !Number.isSafeInteger(page) || page < 1 || page > 100000) {
    res.status(400).json({ message: 'Invalid message filters.' }); return;
  }
  const filter = status === 'all' ? {} : { status };
  try {
    const [messages, total] = await Promise.all([
      ContactMessage.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 25).limit(25).select('-submissionId').lean(),
      ContactMessage.countDocuments(filter),
    ]);
    res.json({ messages, total, page, pageSize: 25, emailConfigured: contactEmailConfigured() });
  } catch { res.status(503).json({ message: 'Messages could not be loaded. Please try again.' }); }
});
router.patch('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id) || !CONTACT_STATUSES.includes(req.body?.status)) { res.status(400).json({ message: 'Invalid message or status.' }); return; }
  try {
    const record = await ContactMessage.findByIdAndUpdate(req.params.id, { $set: { status: req.body.status } }, { new: true, runValidators: true }).select('-submissionId');
    if (!record) { res.status(404).json({ message: 'Message not found.' }); return; }
    res.json(record);
  } catch { res.status(503).json({ message: 'Message status could not be saved.' }); }
});
router.post('/:id/notify', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ message: 'Invalid message.' }); return; }
  if (!contactEmailConfigured()) { res.status(503).json({ message: 'Configure the backend SMTP settings before sending notifications.' }); return; }
  try {
    const existing = await ContactMessage.findById(req.params.id);
    if (!existing) { res.status(404).json({ message: 'Message not found.' }); return; }
    await notifyContact(existing.id);
    res.json(await ContactMessage.findById(existing.id).select('-submissionId'));
  } catch { res.status(503).json({ message: 'Notification could not be processed. The message is still saved.' }); }
});
export default router;
