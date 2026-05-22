// server/src/routes/gallery.ts
import { Router } from 'express';
import {
  getGallery,
  uploadGalleryImage,
  updateGalleryItem,
  deleteGalleryItem,
} from '../controllers/galleryController';
import { protect, adminOnly } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

// Public
router.get('/', getGallery);

// Admin only
router.post('/',    protect, adminOnly, upload.single('image'), uploadGalleryImage);
router.put('/:id',  protect, adminOnly, updateGalleryItem);
router.delete('/:id', protect, adminOnly, deleteGalleryItem);

export default router;