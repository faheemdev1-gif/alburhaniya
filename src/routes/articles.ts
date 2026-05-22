import { Router } from 'express';
import {
  getArticles,
  getFeaturedArticle,
  getArticleById,
  getRelatedArticles,
  createArticle,
  updateArticle,
  deleteArticle,
} from '../controllers/articleController';
import { protect, adminOnly } from '../middleware/auth';

const router = Router();

// Public
router.get('/',            getArticles);
router.get('/featured',    getFeaturedArticle);
router.get('/:id',         getArticleById);
router.get('/:id/related', getRelatedArticles);

// Admin only — NO upload middleware here, articles use JSON
router.post('/',      protect, adminOnly, createArticle);
router.put('/:id',    protect, adminOnly, updateArticle);
router.delete('/:id', protect, adminOnly, deleteArticle);

export default router;