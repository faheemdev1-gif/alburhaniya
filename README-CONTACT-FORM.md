# Homepage contact form

The homepage now submits to POST /api/contact. A success message appears only
after MongoDB stores the enquiry. A failed request keeps all form values.
Admin > Messages lists enquiries, with pagination and new/read/resolved filters.
Admins can change status and use Reply by email to open their email application.
This does not send a reply automatically. Other staff roles cannot read enquiries.

Messages are saved before attempting an email notification. Notification failure
does not discard the enquiry or tell the visitor to submit it again. The inbox
shows notification status and offers a retry for unsent notifications.
"Accepted by mail server" does not guarantee delivery to the destination inbox.
There is no visitor auto-reply.

## Deploy

Deploy BOTH the updated backend and frontend, including previous image fixes.
Use Node 22.x. For the backend ZIP, package.json is at the archive root:

- Hostinger: existing backend > Dashboard > Redeploy > Upload new files.
- Upload al-burhaniya-backend.zip.
- Root directory: .
- Build: npm ci --include=dev --include=optional && npm run build
- Start: npm start
- PORT=3000; retain existing MONGODB_URI, JWT_SECRET and admin credentials.
- If using a whole-project GitHub deployment instead, replace server/ and set root server.

Frontend: replace src/, package.json, package-lock.json, scripts/ and tests/
in your existing project connected to Vercel. Set VITE_API_URL to
https://peru-nightingale-490437.hostingersite.com/api in Vercel's Production
environment, commit/push the updated source and wait for the new deployment.

## Update the existing backend Git repository on a Mac

Hostinger uses https://github.com/faheemdev1-gif/alburhaniya.git, branch main,
with the backend package.json at the repository root. Clone this backend into
its own folder beside the frontend, then open that folder in VS Code.
The frontend's old server gitlink has no submodule mapping; cloning the backend
separately preserves its existing Git history and remote.

Download the latest backend ZIP and save it in Downloads as
al-burhaniya-backend.zip. From the cloned backend's root, extract all files,
including hidden files, without copying through Finder:

    unzip -o "$HOME/Downloads/al-burhaniya-backend.zip" -d .
    npm ci
    npm test

The ZIP has no .git or private .env, so extraction preserves those local files.
Then stage the supplied source, scripts, tests, manifests, .node-version,
.gitignore, .env.example and README files; commit and push origin main.
Wait for Hostinger's automatic deployment and confirm contact-v1 in health.

Runtime dependencies have been refreshed within their compatible version
ranges. The unsupported ts-node-dev watcher was replaced with tsx; dev now uses
tsx watch, and seed/migrate:images use tsx too. Audit and tests are rerun when
packaging; npm audit reports advisory status at the time it is run, not a
guarantee that new advisories will never appear.

Health: https://peru-nightingale-490437.hostingersite.com/api/health
should include contact.contract = contact-v1. emailConfigured indicates only
whether configuration values exist; it is not an SMTP connectivity test.

## Email notifications

No additional contact-form API account is required. Use your existing mailbox's
SMTP service. For an actual Hostinger Email mailbox, add these settings in the
BACKEND environment, not in Vercel or in any VITE_* variable:

    SMTP_HOST=smtp.hostinger.com
    SMTP_PORT=465
    SMTP_SECURE=true
    SMTP_USER=info@al-burhaniyainternational.co.uk
    SMTP_PASS=YOUR_MAILBOX_PASSWORD
    CONTACT_FROM_EMAIL=info@al-burhaniyainternational.co.uk
    CONTACT_TO_EMAIL=info@al-burhaniyainternational.co.uk

SMTP_USER must be a real mailbox you control. SMTP_PASS is that mailbox's
password, not your Hostinger account password. CONTACT_FROM_EMAIL must be a
sender your provider allows. CONTACT_TO_EMAIL is where notifications arrive;
you may change it to another address you own. The visitor email is Reply-To,
never the From address. Changing the public contact email in Website Content
does not change these backend delivery settings.

If your mailbox uses Titan, Microsoft, Google, or another service, use that
provider's SMTP host and authentication requirements instead. For port 587 set
SMTP_SECURE=false; STARTTLS is required. TLS certificate validation stays enabled.
Do not paste passwords into chat, commit them to Git, or put them in the frontend.
Redeploy after changing backend settings.

Without complete SMTP configuration, the inbox still works and notifications
are marked disabled. After configuring email, admins can retry unsent notifications.
No real message is sent during the included automated tests.

## Verification

1. Confirm contact-v1 in health.
2. Submit a test enquiry from the public homepage.
3. Log in with an admin account and open /admin/messages.
4. Confirm sender, selected interest, and message; mark it read/resolved.
5. Confirm the notification arrives at CONTACT_TO_EMAIL, and Reply targets the visitor.
6. If notification is failed, check SMTP values and mail-provider restrictions;
   use Retry email notification in the inbox after fixing them.

Run backend tests with cd server && npm test. From project root run npm test,
npm run build and npm run test:contact:browser after installing Playwright Chromium.
An existing Chromium may be used with CHROMIUM_EXECUTABLE_PATH.

## Limits

Names: 80 characters each; email: 254; message: 5,000; JSON request: 16 KiB.
All inputs are validated on the server. The hidden website field catches simple
bots; sender and connection-IP rate limits protect against basic repeated abuse.
Limits are in memory per process, reset on restart, and are not distributed.
The server does not trust arbitrary forwarded IP headers. Large campaigns or
multiple backend replicas may require shared limits and a CAPTCHA later.

Each submission uses a UUID to avoid duplicate records on retry. MongoDB's unique
index enforces this. Notifications are claimed atomically to avoid concurrent
sends; a stuck attempt can be retried after five minutes. SMTP cannot guarantee
exactly-once delivery if a process exits after sending and before recording success.
Messages remain until you manage retention in the database; no automatic deletion
has been added. This version has no inbox deletion action.

Provider references:
https://nodemailer.com/smtp
https://www.hostinger.com/support/1575756-how-to-get-email-account-configuration-details-for-hostinger-email/
