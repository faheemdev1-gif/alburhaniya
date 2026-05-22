// server/src/routes/events.ts
import { Router, Request, Response } from 'express';
import slugify from 'slugify';
import Event from '../models/Event';
import { protect, adminOnly } from '../middleware/auth';

const router = Router();

// ── GET /api/events ──────────────────────────────────────────────
// Query params: status, category, search, featured, limit, page
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, category, search, featured, limit = 20, page = 1 } = req.query;

    // Auto-update statuses based on today's date
    const today = new Date().toISOString().split('T')[0];
    await Event.updateMany({ dateISO: { $lt: today }, status: 'upcoming' }, { status: 'past' });
    await Event.updateMany({ dateISO: { $gte: today }, status: 'past'     }, { status: 'upcoming' });

    const filter: Record<string, unknown> = {};
    if (status)   filter.status      = status;
    if (category && category !== 'all') filter.categoryKey = category;
    if (featured) filter.featured    = featured === 'true';
    if (search) {
      const q = new RegExp(search as string, 'i');
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
    const event = await Event.findOne({ featured: true, status: 'upcoming' });
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
    res.json(event);
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
      status: 'upcoming',
      categoryKey: event.categoryKey,
    }).limit(3);

    // Pad with other upcoming events if not enough same-category
    if (related.length < 3) {
      const more = await Event.find({
        _id: { $nin: [event._id, ...related.map(r => r._id)] },
        status: 'upcoming',
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
    const body = req.body;
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
    const body = req.body;

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
// Increments registered count by 1
router.patch('/:id/register', async (req: Request, res: Response) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) { res.status(404).json({ message: 'Event not found' }); return; }
    if (event.registered >= event.capacity) {
      res.status(400).json({ message: 'Event is fully booked' }); return;
    }
    event.registered += 1;
    await event.save();
    res.json({ registered: event.registered, spotsLeft: event.capacity - event.registered });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
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