import { Router, Request, Response } from 'express';
import SiteContent from '../models/SiteContent';
import { protect, adminOnly } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { uploadMedia, serveMedia } from './media';

//fageen
const router = Router();
const sections = new Set(['hero','stats','about','activities','events','articles','gallery','join','donate','testimonials','contact','newsletter','innerPages','navigation','branding']);
function valid(value: unknown, depth = 0): boolean {
  if (depth > 5) return false;
  if (typeof value === 'string') return value.length <= 15000;
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length <= 50 && value.every(item => valid(item,depth+1));
  if (value && typeof value === 'object') return Object.entries(value).length <= 40 && Object.entries(value).every(([key,v]) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(key) && valid(v,depth+1));
  return false;
}
router.get('/', async (_req: Request, res: Response) => {
  try { res.json((await SiteContent.findOne({key:'website'}).lean())?.content || {}); }
  catch { res.status(503).json({message:'Content unavailable'}); }
});
router.put('/', protect, adminOnly, async (req: Request, res: Response) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== sections.size || !Object.keys(body).every(k=>sections.has(k)) || !valid(body)) {
    return res.status(400).json({message:'Invalid website content'});
  }
  try {
    await SiteContent.findOneAndUpdate({key:'website'}, {$set:{content:body}}, {upsert:true,runValidators:true});
    res.json(body);
  } catch { res.status(503).json({message:'Could not save website content'}); }
});
// Preserve URLs issued by the first content-editor release.
router.get('/media/:id', serveMedia);
router.post('/image', protect, adminOnly, upload.single('image'), uploadMedia);
export default router;
