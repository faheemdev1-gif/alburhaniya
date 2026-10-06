import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { protect, adminOnly } from '../middleware/auth';
import { upload } from '../middleware/upload';
import SiteMedia from '../models/SiteMedia';
import { saveMedia, mediaUrl } from '../services/mediaStorage';
import { sendUploadError } from '../middleware/upload';

// Retain imports used by the existing migration script.
export { saveMedia, mediaUrl };

const router = Router();

export async function uploadMedia(req: Request, res: Response): Promise<void> {
  if (!req.file) { res.status(400).json({message:'Choose an image to upload.'}); return; }
  try { res.status(201).json(await saveMedia(req.file)); }
  catch (err) { sendUploadError(err, res); }
}

export async function serveMedia(req: Request, res: Response): Promise<void> {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404).end(); return; }
  try {
    const media = await SiteMedia.findById(req.params.id).select('mime data thumbData');
    if (!media) { res.status(404).end(); return; }
    const buffer = req.params.variant === 'thumbnail' && media.thumbData ? media.thumbData : media.data;
    res.set('Content-Type',media.mime);
    res.set('Cache-Control','public, max-age=31536000, immutable');
    res.set('X-Content-Type-Options','nosniff');
    res.send(buffer);
  } catch { res.status(503).end(); }
}

router.get('/:id', serveMedia);
router.get('/:id/:variant', (req,res,next) => req.params.variant==='thumbnail' ? serveMedia(req,res) : next());
router.post('/', protect, adminOnly, upload.single('image'), uploadMedia);
export default router;
