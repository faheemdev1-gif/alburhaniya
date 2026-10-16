// server/src/routes/events.ts
import { Router, Request, Response } from 'express';
import slugify from 'slugify';
import Event from '../models/Event';
import { registerForEvent } from '../services/eventRegistration';
import { notifyEventRegistration } from '../services/eventNotification';
import { eventMailbox, siteEmailConfigured } from '../services/siteEmail';
import mongoose from 'mongoose';
import { londonToday } from '../services/eventDate';
import { protect, adminOnly } from '../middleware/auth';

const router = Router();

// ── GET /api/events ──────────────────────────────────────────────
// Query params: status, category, search, featured, limit, page
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, category, search, featured, limit = 20, page = 1 } = req.query;

    if (!Number.isSafeInteger(Number(page)) || Number(page) < 1 || !Number.isSafeInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 100 || (status && !['past', 'upcoming'].includes(String(status))) || (search && (typeof search !== 'string' || search.length > 200))) { res.status(400).json({ message: 'Invalid event filters.' }); return; }

    // Auto-update statuses based on today's date
    const today = londonToday();
    await Event.updateMany({ dateISO: { $lt: today }, status: 'upcoming' }, { status: 'past' });
    await Event.updateMany({ dateISO: { $gte: today }, status: 'past'     }, { status: 'upcoming' });

    const filter: Record<string, unknown> = {};
    if (status)   filter.status      = status;
    if (category && category !== 'all') filter.categoryKey = category;
    if (featured) filter.featured    = featured === 'true';
    if (search) {
      const q = new RegExp((search as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: q }, { category: q }, { location: q }, { tags: q }];
    }

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Event.countDocuments(filter);
    const events = await Event.find(filter)
      .sort({ dateISO: status === 'past' ? -1 : 1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({ events, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

// ── GET /api/events/featured ─────────────────────────────────────
router.get('/featured', async (_req: Request, res: Response) => {
  try {
    const event = await Event.findOne({ featured: true, dateISO: { $gte: londonToday() } }).sort({ dateISO: 1 });
    res.json(event);
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

// ── GET /api/events/:id ──────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    // Support lookup by MongoDB _id OR by slug
    const { id } = req.params;
    const event = id.match(/^[0-9a-fA-F]{24}$/)
      ? await Event.findById(id)
      : await Event.findOne({ slug: id });

    if (!event) { res.status(404).json({ message: 'Event not found' }); return; }
    res.json({ ...event.toObject(), status: event.dateISO < londonToday() ? 'past' : 'upcoming' });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

// ── GET /api/events/:id/related ──────────────────────────────────
router.get('/:id/related', async (req: Request, res: Response) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) { res.status(404).json({ message: 'Event not found' }); return; }

    const related = await Event.find({
      _id: { $ne: event._id },
      dateISO: { $gte: londonToday() },
      categoryKey: event.categoryKey,
    }).limit(3);

    // Pad with other upcoming events if not enough same-category
    if (related.length < 3) {
      const more = await Event.find({
        _id: { $nin: [event._id, ...related.map(r => r._id)] },
        dateISO: { $gte: londonToday() },
      }).limit(3 - related.length);
      related.push(...more);
    }

    res.json(related);
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

// ── POST /api/events  (admin) ────────────────────────────────────
router.post('/', protect, adminOnly, async (req: Request, res: Response) => {
  try {
    const body = { ...req.body };
    delete body.registrations; delete body.registered;
    if (Object.keys(body).some(key => key.startsWith('$') || key.includes('.'))) { res.status(400).json({ message: 'Invalid event fields.' }); return; }
    const slug = slugify(body.title, { lower: true, strict: true });

    // Derive day / month / year from dateISO
    const d = new Date(body.dateISO);
    const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    body.day   = String(d.getDate()).padStart(2, '0');
    body.month = MONTHS[d.getMonth()];
    body.year  = String(d.getFullYear());

    const event = await Event.create({ ...body, slug });
    res.status(201).json(event);
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
});

// ── PUT /api/events/:id  (admin) ─────────────────────────────────
router.put('/:id', protect, adminOnly, async (req: Request, res: Response) => {
  try {
    const body = { ...req.body };
    delete body.registrations; delete body.registered;
    if (Object.keys(body).some(key => key.startsWith('$') || key.includes('.'))) { res.status(400).json({ message: 'Invalid event fields.' }); return; }

    if (body.dateISO) {
      const d = new Date(body.dateISO);
      const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      body.day   = String(d.getDate()).padStart(2, '0');
      body.month = MONTHS[d.getMonth()];
      body.year  = String(d.getFullYear());
    }
    if (body.title) {
      body.slug = slugify(body.title, { lower: true, strict: true });
    }

    const event = await Event.findByIdAndUpdate(req.params.id, body, {
      new: true, runValidators: true,
    });
    if (!event) { res.status(404).json({ message: 'Event not found' }); return; }
    res.json(event);
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
});

// ── PATCH /api/events/:id/register  (public) ────────────────────
// Saves attendee details and reserves the requested places atomically
router.patch('/:id/register', registerForEvent);
router.post('/:id/register', registerForEvent);

router.get('/:id/registrations', protect, adminOnly, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const page = Number(req.query.page || 1);
  if (!mongoose.isValidObjectId(req.params.id) || !Number.isSafeInteger(page) || page < 1 || page > 100000) {
    res.status(400).json({ message: 'Invalid event or page.' }); return;
  }
  try {
    const event = await Event.findById(req.params.id).select('+registrations');
    if (!event) { res.status(404).json({ message: 'Event not found.' }); return; }
    const rows = [...event.registrations].reverse();
    res.json({ event: { _id: event._id, title: event.title, registered: event.registered, capacity: event.capacity },
      registrations: rows.slice((page - 1) * 25, page * 25).map(row => {
        const { submissionId, ...safe } = (row as any).toObject(); return safe;
      }), total: rows.length, page, emailConfigured: siteEmailConfigured(eventMailbox()) });
  } catch { res.status(503).json({ message: 'Registrations could not be loaded.' }); }
});
router.post('/:id/registrations/:registrationId/notify', protect, adminOnly, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.registrationId)) {
    res.status(400).json({ message: 'Invalid registration.' }); return;
  }
  if (!siteEmailConfigured(eventMailbox())) { res.status(503).json({ message: 'Configure backend SMTP before retrying emails.' }); return; }
  try {
    const found = await Event.exists({ _id: req.params.id, 'registrations._id': req.params.registrationId });
    if (!found) { res.status(404).json({ message: 'Registration not found.' }); return; }
    await notifyEventRegistration(req.params.id, req.params.registrationId);
    res.json({ message: 'Email retry processed. Refresh to check delivery status.' });
  } catch { res.status(503).json({ message: 'Email retry could not be processed. Registration remains saved.' }); }
});

// ── DELETE /api/events/:id  (admin) ─────────────────────────────
router.delete('/:id', protect, adminOnly, async (req: Request, res: Response) => {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) { res.status(404).json({ message: 'Event not found' }); return; }
    res.json({ message: 'Event deleted' });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

export default router;