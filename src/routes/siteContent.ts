import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import SiteContent from '../models/SiteContent';
import SiteMedia from '../models/SiteMedia';
import mongoose from 'mongoose';
import { protect, adminOnly } from '../middleware/auth';
import { upload } from '../middleware/upload';

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
router.get('/media/:id', async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  try {
    const media = await SiteMedia.findById(req.params.id);
    if (!media) return res.status(404).end();
    res.set('Content-Type', media.mime);
    res.set('Cache-Control','public, max-age=31536000, immutable');
    return res.send(media.data);
  } catch { return res.status(503).end(); }
});
router.post('/image', protect, adminOnly, upload.single('image'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({message:'Choose a JPG, PNG, GIF, or WebP image under the upload limit.'});
  try {
    const bytes = fs.readFileSync(req.file.path);
    const jpg = bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff;
    const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const gif = bytes.toString('ascii',0,6)==='GIF87a' || bytes.toString('ascii',0,6)==='GIF89a';
    const webp = bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
    const mime = jpg?'image/jpeg':png?'image/png':gif?'image/gif':webp?'image/webp':'';
    if (!mime) return res.status(400).json({message:'Invalid image file'});
    const media = await SiteMedia.create({mime,data:bytes});
    return res.json({url:`/api/site-content/media/${media.id}`});
  } catch { return res.status(503).json({message:'Could not store image'}); }
  finally { fs.unlink(req.file.path,()=>{}); }
});
export default router;
