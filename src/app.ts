// server/src/server.ts  —  Express app entry point
import express from 'express';
import cors    from 'cors';
import path    from 'path';
import multer from 'multer';
import { ImageUploadError, mediaStorageStatus } from './services/mediaStorage';
import { maxUploadSizeMB, sendUploadError } from './middleware/upload';
import authRoutes       from './routes/auth';
import eventRoutes      from './routes/events';
import articleRoutes    from './routes/articles';
import galleryRoutes    from './routes/gallery';
import siteContentRoutes from './routes/siteContent';
import mediaRoutes from './routes/media';
import contactRoutes from './routes/contact';
import { contactEmailConfigured } from './services/contactNotification';


const app  = express();


// ── Global middleware ─────────────────────────────────────────────
const corsOptions = {
  origin: [
    'https://alburhaniya-clientside.vercel.app',
    'https://al-burhaniyainternational.co.uk',
    'https://www.al-burhaniyainternational.co.uk',
    'http://al-burhaniyainternational.co.uk',
    'http://www.al-burhaniyainternational.co.uk',
    /^http:\/\/localhost(:\d+)?$/,
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));


app.use('/api/contact', express.json({ limit: '16kb' }), contactRoutes);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded images as static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── API routes ────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/events',   eventRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/gallery',  galleryRoutes);
app.use('/api/site-content', siteContentRoutes);
app.use('/api/media', mediaRoutes);

// ── Health check ──────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(),
    uploadContract:'image-upload-v3',mediaStorage:mediaStorageStatus(),
    contact:{contract:'contact-v1',emailConfigured:contactEmailConfigured()},
    uploads:{endpoints:['/api/media','/api/site-content/image','/api/gallery'],
      maxFileSizeMB:maxUploadSizeMB(),maxInputPixels:40_000_000,formats:['jpeg','png','webp','gif']} });
});

// ── 404 ───────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// ── Global error handler ──────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if ((err as any).type === 'entity.too.large') return res.status(413).json({message:'The submitted form is too large.'});
  if ((err as any).type === 'entity.parse.failed') return res.status(400).json({message:'Invalid JSON form data.'});
  if (err instanceof multer.MulterError || err instanceof ImageUploadError) {
    return sendUploadError(err, res);
  }
  console.error('[Error]', err.message);
  return res.status(500).json({message:'Internal server error'});
});

export default app;
