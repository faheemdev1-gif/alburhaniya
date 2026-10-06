// server/src/controllers/galleryController.ts
import { Request, Response } from 'express';
import { saveMedia } from '../routes/media';
import { sendUploadError } from '../middleware/upload';
import GalleryItem from '../models/Gallery';

// ── GET /api/gallery ─────────────────────────────────────────────
export async function getGallery(req: Request, res: Response): Promise<void> {
  try {
    const { category, limit = 50, page = 1 } = req.query;

    const filter: Record<string, unknown> = {};
    if (category && category !== 'all') filter.category = category;

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await GalleryItem.countDocuments(filter);
    const items = await GalleryItem.find(filter)
      .sort({ order: 1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({
      items,
      total,
      page:  Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
}

// ── POST /api/gallery ────────────────────────────────────────────
export async function uploadGalleryImage(req: Request, res: Response): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ message: 'No image file uploaded' });
      return;
    }

    const { title, category = 'general', size = 'normal', order = 0 } = req.body;

    if (!title || typeof title !== 'string' || title.length > 160) {
      res.status(400).json({ message: 'Title is required' });
      return;
    }

    if (!['gatherings','music','sports','arts','dance','general'].includes(category) || !['normal','tall','wide'].includes(size) || !Number.isFinite(Number(order))) {
      res.status(400).json({message:'Invalid gallery category, size, or order'}); return;
    }

    const stored = await saveMedia(req.file);

    const item = await GalleryItem.create({
      title,
      category,
      imageUrl: stored.url,
      thumbnailUrl: stored.thumbnailUrl,
      filename: '',
      size,
      order: Number(order),
    });

    res.status(201).json(item);
  } catch (err) {
    sendUploadError(err, res);
  }
}

// ── PUT /api/gallery/:id ─────────────────────────────────────────
export async function updateGalleryItem(req: Request, res: Response): Promise<void> {
  try {
    const existing = await GalleryItem.findById(req.params.id);
    if (!existing) { res.status(404).json({ message: 'Gallery item not found' }); return; }
    const allowedFields = ['title', 'category', 'size', 'order'];
    const update: Record<string, unknown> = {};
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    });

    // Validate metadata before storing a replacement image.
    existing.set(update);
    await existing.validate();
    if (req.file) {
      const stored=await saveMedia(req.file);
      update.imageUrl=stored.url;
      update.thumbnailUrl=stored.thumbnailUrl;
      update.filename='';
    }

    const item = await GalleryItem.findByIdAndUpdate(req.params.id, update, {
      new: true, runValidators: true,
    });
    if (!item) { res.status(404).json({ message: 'Gallery item not found' }); return; }
    res.json(item);
  } catch (err) {
    if ((err as Error).name === 'ValidationError' || (err as Error).name === 'CastError') {
      res.status(400).json({message:'Invalid gallery details'}); return;
    }
    sendUploadError(err, res);
  }
}

// ── DELETE /api/gallery/:id ──────────────────────────────────────
export async function deleteGalleryItem(req: Request, res: Response): Promise<void> {
  try {
    const item = await GalleryItem.findByIdAndDelete(req.params.id);
    if (!item) { res.status(404).json({ message: 'Gallery item not found' }); return; }

    // Keep the media asset because other pages may reuse its URL.

    res.json({ message: 'Gallery item deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
}
