// server/src/server.ts  —  Express app entry point
import express from 'express';
import cors    from 'cors';
import dotenv  from 'dotenv';
import path    from 'path';
import { connectDB }    from './config/db';
import authRoutes       from './routes/auth';
import eventRoutes      from './routes/events';
import articleRoutes    from './routes/articles';
import galleryRoutes    from './routes/gallery';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Database ─────────────────────────────────────────────────────
connectDB();

// ── Global middleware ─────────────────────────────────────────────
app.use(cors({
  origin: [
    'https://alburhaniya-clientside.vercel.app',
    'https://al-burhaniyainternational.co.uk',
    'https://www.al-burhaniyainternational.co.uk',
    'http://al-burhaniyainternational.co.uk',
    'http://www.al-burhaniyainternational.co.uk',
    /^http:\/\/localhost(:\d+)?$/,
  ],
  credentials: true,
}));

app.options('*', cors());   // ← add this line

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded images as static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── API routes ────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/events',   eventRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/gallery',  galleryRoutes);

// ── Health check ──────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── 404 ───────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// ── Global error handler ──────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Error]', err.message);
  res.status(500).json({ message: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  Server running  →  http://localhost:${PORT}`);
  console.log(`    Environment     →  ${process.env.NODE_ENV}`);
  console.log(`    MongoDB         →  ${process.env.MONGODB_URI}\n`);
});

export default app;