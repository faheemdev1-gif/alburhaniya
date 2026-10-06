# Image upload update

See **README-IMAGE-UPLOAD-FIX.md** at the project root for the missing-route fix, deployment checklist, and optional Cloudinary integration. MongoDB remains the default.

# Website content and image uploads

The admin panel has **Website Content** at `/admin/content` for the homepage, navigation, page introductions, branding, and footer. Articles, events, and gallery entries have their own admin pages.

## Image upload design

All admin upload controls now accept originals up to 20 MB and automatically resize/compress them below 900 KiB before transfer. The backend limit below applies to that compressed file. Gallery photos can also be replaced, and article/event bodies support inserted images.

- The slider, About section, testimonials, logo, article covers and author avatars, event images, and gallery all use an authenticated `/api/media` uploader. Admins can also paste an image URL where a field allows it.
- The backend checks the image, accepts JPG/PNG/WebP/GIF up to 10 MB by default, auto-orients it, removes metadata, and stores a WebP image (longest side at most 1920 px) plus a 640 px thumbnail in MongoDB. GIFs become still images.
- Each upload returns a public immutable URL and thumbnail URL. Image bytes are not stored on Render's temporary disk. Gallery grids use thumbnails and the lightbox uses the full image. An event upload fills both main and thumbnail fields.
- Older `/api/site-content/media/:id` URLs remain valid. Existing external URLs and `/uploads/` references are displayed as before, but old `/uploads/` files must be migrated while they are still accessible.

## Deploy and migrate older images

1. **Before redeploying an old Render backend**, use a machine with access to your MongoDB and the existing backend URL. Set `MONGODB_URI` and `LEGACY_UPLOAD_BASE=https://your-old-backend.example`. From `server`, run `npm ci` and `npm run migrate:images` to see how many legacy URLs exist. Then run `npm run migrate:images -- --apply`. The command copies accessible `/uploads/` images into MongoDB and updates gallery, article, and event references. It reports unavailable files and does not delete old images. Keep a database backup before applying the migration.
2. Deploy the updated `server` and frontend. The existing `MONGODB_URI`, `JWT_SECRET`, and admin account remain in use. Set `MAX_FILE_SIZE_MB=10` on the backend if the earlier deployment used a lower value. Set frontend `VITE_API_URL` at build time to the backend URL ending in `/api`. Rebuild the frontend.
3. Log in as an admin and upload a test image in **Website Content**. Publish changes and refresh the public page. Also test an article, event, and gallery upload.

If legacy files were already lost on a server restart, the migration cannot reconstruct them. Reupload those originals in the admin panel. The new media collection uses database storage and bandwidth; for a high-traffic or very large photo archive, optional Cloudinary storage is now implemented. See README-IMAGE-UPLOAD-FIX.md at the project root for environment settings and deployment checks.

The site displays built-in text until the first content save. Slider titles and headings accept `<em>` and `<br/>`. The contact and newsletter forms still display success messages without delivery/subscription backends. Stripe payment configuration is outside this editor.

## Local build

```sh
npm ci && npm run build
cd server && npm ci && npm run build
```

For local development run `npm run dev` in `server` and at the project root. Set environment values separately; no credentials are included in this ZIP.
