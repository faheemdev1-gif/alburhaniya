/** Move legacy /uploads/ references before replacing the old web service. */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import fs from 'fs/promises';
import path from 'path';
import GalleryItem from './models/Gallery';
import Article from './models/Article';
import Event from './models/Event';
import { saveMedia } from './routes/media';

dotenv.config();
const apply = process.argv.includes('--apply');
const base = process.env.LEGACY_UPLOAD_BASE?.replace(/\/$/,'');
const maxBytes = 10 * 1024 * 1024;
function legacyPath(value: string): string | null {
  try {
    const url = new URL(value, base || 'http://localhost');
    if (base && url.host !== new URL(base).host) return null;
    return /^\/uploads\/[a-zA-Z0-9._-]+$/.test(url.pathname) ? url.pathname : null;
  } catch { return null; }
}
async function bytesFor(imagePath:string):Promise<Buffer> {
  const local = path.join(process.cwd(),'uploads',path.basename(imagePath));
  try { return await fs.readFile(local); } catch { /* fetch from old backend */ }
  if (!base) throw new Error('Set LEGACY_UPLOAD_BASE to the old backend URL before redeploying it.');
  const response = await fetch(`${base}${imagePath}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('Image exceeds 10 MB');
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > maxBytes) throw new Error('Image exceeds 10 MB');
  return data;
}
async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const [gallery,articles,events] = await Promise.all([GalleryItem.find(),Article.find(),Event.find()]);
    const refs = new Set<string>();
    for(const item of gallery) if (legacyPath(item.imageUrl)) refs.add(item.imageUrl);
    for(const item of articles) for(const url of [item.image,item.authorAvatar]) if(url && legacyPath(url)) refs.add(url);
    for(const item of events) for(const url of [item.image,item.thumbImage]) if(url && legacyPath(url)) refs.add(url);
    console.log(`Found ${refs.size} unique legacy upload URLs in ${gallery.length} gallery, ${articles.length} article, and ${events.length} event records.`);
    if (!apply) {console.log('Dry run. Run with --apply while the old backend still serves its uploads.');return;}
    const mapped = new Map<string,{url:string;thumbnailUrl:string}>();
    let failed = 0;
    for(const url of refs) {
      try {
        const imagePath=legacyPath(url)!;
        const buffer=await bytesFor(imagePath);
        const stored=await saveMedia({buffer,originalname:path.basename(imagePath)} as Express.Multer.File);
        mapped.set(url,stored);
        console.log(`Migrated ${imagePath}`);
      } catch(err) { failed++;console.error(`Failed ${url}:`,err instanceof Error?err.message:err); }
    }
    for(const item of gallery) {
      const media=mapped.get(item.imageUrl);
      if(media) {item.imageUrl=media.url;item.thumbnailUrl=media.thumbnailUrl;await item.save();}
    }
    for(const item of articles) {
      let changed=false;
      const cover=mapped.get(item.image);if(cover){item.image=cover.url;changed=true;}
      const avatar=mapped.get(item.authorAvatar);if(avatar){item.authorAvatar=avatar.thumbnailUrl;changed=true;}
      if(changed) await item.save();
    }
    for(const item of events) {
      let changed=false;
      const cover=mapped.get(item.image);if(cover){item.image=cover.url;changed=true;}
      const thumb=mapped.get(item.thumbImage);if(thumb){item.thumbImage=thumb.thumbnailUrl;changed=true;}
      if(changed) await item.save();
    }
    console.log(`Completed ${mapped.size} images; ${failed} unavailable. Run the dry run again to review remaining legacy URLs.`);
    if(failed) process.exitCode=1;
  } finally {await mongoose.disconnect();}
}
main().catch(err=>{console.error(err);process.exitCode=1;});
