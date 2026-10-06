import multer from 'multer';
import { Response, RequestHandler } from 'express';
import { ImageUploadError } from '../services/mediaStorage';

// Uploads live in memory only until validation and compression finish.
export function maxUploadSizeMB() {
  return Math.min(20, Math.max(1, Number(process.env.MAX_FILE_SIZE_MB) || 10));
}
// Read settings after dotenv has loaded, rather than at import time.
const singleImage: RequestHandler = (req,res,next) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadSizeMB() * 1024 * 1024, files: 1, fields: 10, parts: 11 },
  fileFilter: (_req, file, cb) => {
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype)) {
      return cb(new ImageUploadError(400, 'UNSUPPORTED_IMAGE', 'Choose a JPG, PNG, WebP, or GIF image. Convert HEIC photos to JPG first.'));
    }
    cb(null, true);
  },
}).single('image')(req,res,(err: unknown) => {
  if (err && !(err instanceof multer.MulterError) && !(err instanceof ImageUploadError)) {
    return next(new ImageUploadError(400, 'INVALID_MULTIPART', 'The image request is incomplete. Select the file again and retry.'));
  }
  next(err);
});
export const upload = {single: (_field: 'image') => singleImage};

export function sendUploadError(err: unknown, res: Response) {
  if (err instanceof ImageUploadError) return res.status(err.status).json({code:err.code,message:err.message});
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? `Image exceeds the ${maxUploadSizeMB()} MB upload limit.` :
      err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Upload one image using the image field.' : 'Invalid image upload. Upload one image at a time.';
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({code:err.code,message});
  }
  return res.status(503).json({code:'MEDIA_STORAGE_UNAVAILABLE',message:'Image upload is unavailable. Please try again.'});
}
