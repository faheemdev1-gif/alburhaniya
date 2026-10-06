// Load environment settings before importing routes or middleware.
import 'dotenv/config';
import app from './app';
import { connectDB } from './config/db';
import { validateMediaStorageConfig, mediaStorageStatus } from './services/mediaStorage';
import ContactMessage from './models/ContactMessage';
import NewsletterSubscriber from './models/NewsletterSubscriber';

async function start() {
  validateMediaStorageConfig();
  await connectDB();
  // Ensure the submission UUID index exists before accepting contact enquiries.
  await ContactMessage.init();
  await NewsletterSubscriber.init();
  const port = process.env.PORT || 5000;
  app.listen(port, () => {
    console.log(`Server listening on port ${port}; image storage: ${mediaStorageStatus().provider}`);
  });
}
start().catch(() => {
  console.error('Startup failed. Check database and MEDIA_STORAGE configuration.');
  process.exit(1);
});
export default app;
