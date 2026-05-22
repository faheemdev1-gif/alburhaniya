// server/src/controllers/galleryController.ts
import { Request, Response } from 'express';
import path from 'path';
import fs   from 'fs';
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

    if (!title) {
      res.status(400).json({ message: 'Title is required' });
      return;
    }

    const baseUrl  = `${req.protocol}://${req.get('host')}`;
    const imageUrl = `${baseUrl}/uploads/${req.file.filename}`;

    const item = await GalleryItem.create({
      title,
      category,
      imageUrl,
      filename: req.file.filename,
      size,
      order: Number(order),
    });

    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
}

// ── PUT /api/gallery/:id ─────────────────────────────────────────
export async function updateGalleryItem(req: Request, res: Response): Promise<void> {
  try {
    const allowedFields = ['title', 'category', 'size', 'order'];
    const update: Record<string, unknown> = {};
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    });

    const item = await GalleryItem.findByIdAndUpdate(req.params.id, update, {
      new: true, runValidators: true,
    });
    if (!item) { res.status(404).json({ message: 'Gallery item not found' }); return; }
    res.json(item);
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
}

// ── DELETE /api/gallery/:id ──────────────────────────────────────
export async function deleteGalleryItem(req: Request, res: Response): Promise<void> {
  try {
    const item = await GalleryItem.findByIdAndDelete(req.params.id);
    if (!item) { res.status(404).json({ message: 'Gallery item not found' }); return; }

    // Remove physical file from disk
    const filePath = path.join(__dirname, '../../uploads', item.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({ message: 'Gallery item deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
}