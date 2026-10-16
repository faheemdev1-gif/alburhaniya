import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { createHash } from 'crypto';
import Event from '../models/Event';
import { validEmail } from './contactNotification';
import { notifyEventRegistration } from './eventNotification';

import { londonToday } from './eventDate';

const buckets = new Map<string, { count: number; expires: number }>();
function allow(key: string, maximum: number) {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.expires <= now) buckets.delete(k);
  if (!buckets.has(key) && buckets.size >= 10000) return false;
  const row = buckets.get(key) || { count: 0, expires: now + 15 * 60_000 };
  buckets.set(key, row); return ++row.count <= maximum;
}
export async function registerForEvent(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (!req.is('application/json')) { res.status(415).json({ message: 'Send registration details as JSON.' }); return; }
  const body = req.body;
  const text = (key: string) => typeof body?.[key] === 'string' ? body[key].trim() : '';
  const data = { submissionId: text('submissionId'), firstName: text('firstName'), lastName: text('lastName'),
    email: text('email').toLowerCase(), phone: text('phone'), notes: text('notes'), places: body?.places };
  if (!mongoose.isValidObjectId(req.params.id) || !body || Array.isArray(body) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.submissionId) ||
    !data.firstName || data.firstName.length > 80 || !data.lastName || data.lastName.length > 80 ||
    !validEmail(data.email) || /[\x00-\x1f\x7f]/.test(data.firstName + data.lastName + data.email + data.phone) ||
    data.phone.length > 40 || data.notes.length > 2000 || data.notes.includes('\0') ||
    !Number.isInteger(data.places) || data.places < 1 || data.places > 4 || (body.website !== undefined && body.website !== '')) {
    res.status(400).json({ message: 'Check your name, email and number of places (1–4). Notes may contain up to 2,000 characters.' }); return;
  }
  if (!allow(`ip:${req.ip}`, 100) || !allow(`email:${createHash('sha256').update(data.email).digest('hex')}`, 10)) {
    res.setHeader('Retry-After', '900'); res.status(429).json({ message: 'Too many registrations. Please wait 15 minutes before trying again.' }); return;
  }
  try {
    const registrationId = new mongoose.Types.ObjectId();
    // Details and capacity count change in ONE MongoDB document write. No transaction or compensation gap.
    const saved = await Event.findOneAndUpdate({ _id: req.params.id, dateISO: { $gte: londonToday() },
      registrations: { $not: { $elemMatch: { $or: [{ email: data.email }, { submissionId: data.submissionId }] } } },
      $expr: { $lte: [{ $add: ['$registered', data.places] }, '$capacity'] },
    }, { $inc: { registered: data.places }, $push: { registrations: { _id: registrationId, ...data, createdAt: new Date(),
      organiserNotificationStatus: 'pending', confirmationNotificationStatus: 'pending' } } }, { new: true, runValidators: true });
    let id = String(registrationId), event = saved;
    if (!event) {
      const existing = await Event.findById(req.params.id).select('+registrations');
      if (!existing) { res.status(404).json({ message: 'Event not found.' }); return; }
      const previous = existing.registrations.find(row => row.submissionId === data.submissionId);
      if (previous && Object.entries(data).every(([key, value]) => (previous as any)[key] === value)) {
        event = existing; id = String(previous._id);
      } else if (existing.registrations.some(row => row.email === data.email || row.submissionId === data.submissionId)) {
        res.status(409).json({ message: 'A registration already exists for this email or submission. Contact the organiser to change it.' }); return;
      } else {
        res.status(409).json({ message: existing.dateISO < londonToday() ? 'Registration for this event has closed.' : 'There are not enough places left. Choose fewer places or contact the organiser.' }); return;
      }
    }
    try { await notifyEventRegistration(String(event._id), id); }
    catch { console.error('[Events] Notification status update failed; registration is saved.'); }
    res.status(saved ? 201 : 200).json({ message: 'Your registration is saved. Please keep your reference.', reference: id,
      registered: event.registered, spotsLeft: Math.max(0, event.capacity - event.registered) });
  } catch { res.status(503).json({ message: 'Your registration could not be completed. Please try again; your form has been kept.' }); }
}
