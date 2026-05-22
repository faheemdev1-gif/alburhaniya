// server/src/controllers/eventController.ts
import { Request, Response } from 'express';
import slugify from 'slugify';
import Event from '../models/Event';

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function parseDateParts(isoStr: string) {
  const d = new Date(isoStr);
  return {
    day:   String(d.getDate()).padStart(2, '0'),
    month: MONTHS[d.getMonth()],
    year:  String(d.getFullYear()),
  };
}

// ── GET /api/events ──────────────────────────────────────────────
export async function getEvents(req: Request, res: Response): Promise<void> {
  try {
    const { status, category, search, featured, limit = 20, page = 1 } = req.query;

    // Auto-sync status based on today's date
    const today = new Date().toISOString().split('T')[0];
    await Event.updateMany({ dateISO: { $lt: today  }, status: 'upcoming' }, { status: 'past' });
    await Event.updateMany({ dateISO: { $gte: today }, status: 'past'     }, { status: 'upcoming' });

    const filter: Record<string, unknown> = {};
    if (status)                        filter.status      = status;
    if (category && category !== 'all') filter.categoryKey = category;
    if (featured)                      filter.featured    = featured === 'true';
    if (search) {
      const q = new RegExp(search as string, 'i');
      filter.$or = [{ title: q }, { category: q }, { location: q }, { tags: q }];
    }

    const skip   = (Number(page) - 1) * Number(limit);
    const total  = await Event.countDocuments(filter);
    const events = await Event.find(filter)
      .sort({ dateISO: status === 'past' ? -1 : 1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({ events, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
}

// ── GET /api/events/featured ─────────────────────────────────────
export async function getFeaturedEvent(_req: Request, res: Response): Promise<void> {
  try {
    const event = await Event.findOne({ featured: true, status: 'upcoming' });
    res.json(event);
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
}

// ── GET /api/events/:id ──────────────────────────────────────────
export async function getEventById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const event  = id.match(/^[0-9a-fA-F]{24}$/)
      ? await Event.findById(id)
      : await Event.findOne({ slug: id });

    if (!event) { res.status(404).json({ message: 'Event not found' }); return; }
    res.json(event);
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
}

// ── GET /api/events/:id/related ──────────────────────────────────
export async function getRelatedEvents(req: Request, res: Response): Promise<void> {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) { res.status(404).json({ message: 'Event not found' }); return; }

    const related = await Event.find({
      _id: { $ne: event._id },
      status: 'upcoming',
      categoryKey: event.categoryKey,
    }).limit(3);

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
}

// ── POST /api/events ─────────────────────────────────────────────
export async function createEvent(req: Request, res: Response): Promise<void> {
  try {
    const body = { ...req.body };
    body.slug  = slugify(body.title, { lower: true, strict: true });

    if (body.dateISO) {
      const { day, month, year } = parseDateParts(body.dateISO);
      body.day = day; body.month = month; body.year = year;
    }

    const event = await Event.create(body);
    res.status(201).json(event);
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
}

// ── PUT /api/events/:id ──────────────────────────────────────────
export async function updateEvent(req: Request, res: Response): Promise<void> {
  try {
    const body = { ...req.body };
    if (body.title)   body.slug  = slugify(body.title, { lower: true, strict: true });
    if (body.dateISO) {
      const { day, month, year } = parseDateParts(body.dateISO);
      body.day = day; body.month = month; body.year = year;
    }

    const event = await Event.findByIdAndUpdate(req.params.id, body, {
      new: true, runValidators: true,
    });
    if (!event) { res.status(404).json({ message: 'Event not found' }); return; }
    res.json(event);
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
}

// ── PATCH /api/events/:id/register ──────────────────────────────
export async function registerForEvent(req: Request, res: Response): Promise<void> {
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
}

// ── DELETE /api/events/:id ───────────────────────────────────────
export async function deleteEvent(req: Request, res: Response): Promise<void> {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) { res.status(404).json({ message: 'Event not found' }); return; }
    res.json({ message: 'Event deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
}