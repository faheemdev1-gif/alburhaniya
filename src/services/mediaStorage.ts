import sharp, { OutputInfo } from 'sharp';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import SiteMedia from '../models/SiteMedia';

export class ImageUploadError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function mediaStorageStatus() {
  const provider = process.env.MEDIA_STORAGE || 'mongodb';
  const configured = provider === 'mongodb' || (provider === 'cloudinary' &&
    !!process.env.CLOUDINARY_CLOUD_NAME && !!process.env.CLOUDINARY_API_KEY && !!process.env.CLOUDINARY_API_SECRET);
  return {provider, configured};
}

export function validateMediaStorageConfig() {
  const {provider, configured} = mediaStorageStatus();
  if (!['mongodb', 'cloudinary'].includes(provider)) {
    throw new ImageUploadError(503, 'MEDIA_CONFIG', 'MEDIA_STORAGE must be mongodb or cloudinary.');
  }
  if (!configured) throw new ImageUploadError(503, 'MEDIA_CONFIG', 'Cloudinary image storage is not configured on the backend.');
}

export const mediaUrl = (id: string) => `/api/media/${id}`;

export async function saveMedia(file: Express.Multer.File) {
  validateMediaStorageConfig();
  // Validate the actual bytes, not only the browser's MIME type. Keep a pixel
  // limit to bound decoded memory usage, and flatten animated GIFs deliberately.
  const options = {limitInputPixels:40_000_000, animated:false, failOn:'error' as const};
  let full: {data:Buffer; info:OutputInfo};
  let thumb: Buffer;
  try {
    const meta = await sharp(file.buffer, options).metadata();
    if (!['jpeg','png','webp','gif'].includes(meta.format || '')) throw new Error('Unsupported image format');
    const pipeline = sharp(file.buffer, options).rotate();
    full = await pipeline.clone().resize({width:1920,height:1920,fit:'inside',withoutEnlargement:true})
      .webp({quality:82,effort:4}).toBuffer({resolveWithObject:true});
    thumb = await pipeline.clone().resize({width:640,height:640,fit:'inside',withoutEnlargement:true})
      .webp({quality:76,effort:4}).toBuffer();
  } catch {
    throw new ImageUploadError(400, 'INVALID_IMAGE', 'The image could not be processed. Use a valid JPG, PNG, WebP, or GIF under 40 megapixels. Convert HEIC photos to JPG first.');
  }

  if (mediaStorageStatus().provider === 'cloudinary') {
    cloudinary.config({cloud_name:process.env.CLOUDINARY_CLOUD_NAME,
      api_key:process.env.CLOUDINARY_API_KEY,api_secret:process.env.CLOUDINARY_API_SECRET,secure:true});
    try {
      const result = await new Promise<UploadApiResponse>((resolve,reject) => {
        const stream = cloudinary.uploader.upload_stream({resource_type:'image',
          folder:process.env.CLOUDINARY_FOLDER || 'al-burhaniya',format:'webp',
          overwrite:false,timeout:60000}, (error,result) => {
          if (error) reject(error);
          else if (result?.secure_url && result.public_id) resolve(result);
          else reject(new Error('Invalid storage response'));
        });
        stream.on('error',reject);
        stream.end(full.data);
      });
      return {url:result.secure_url,
        thumbnailUrl:cloudinary.url(result.public_id,{secure:true,version:result.version,
          format:'webp',width:640,height:640,crop:'limit',quality:76}),
        width:full.info.width,height:full.info.height,bytes:full.data.length};
    } catch {
      // Provider errors can contain account details; keep them out of responses.
      throw new ImageUploadError(503, 'MEDIA_STORAGE_UNAVAILABLE', 'Cloudinary upload failed. Check the backend credentials and account limits, then try again.');
    }
  }

  try {
    const media = await SiteMedia.create({mime:'image/webp',data:full.data,thumbData:thumb,
      width:full.info.width,height:full.info.height,originalName:file.originalname.slice(0,200)});
    return {url:mediaUrl(media.id),thumbnailUrl:`${mediaUrl(media.id)}/thumbnail`,
      width:full.info.width,height:full.info.height,bytes:full.data.length};
  } catch {
    throw new ImageUploadError(503, 'MEDIA_STORAGE_UNAVAILABLE', 'Image storage is unavailable. Check the backend database connection and storage quota, then try again.');
  }
}
