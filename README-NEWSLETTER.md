# Newsletter sign-up: deployment and use

The homepage “Stay in the Loop” form now saves newsletter requests to MongoDB instead of showing a pretend success message. SMTP sends an email confirmation link. The address joins the confirmed mailing list only after its owner opens the link and presses **Confirm subscription**.

Admin **Subscribers** lets administrators search and filter requests, resend confirmation emails, unsubscribe an address, and export confirmed subscribers as CSV. Pending and unsubscribed addresses are excluded from the export. The email includes a cancellation/unsubscribe link.

Deploy BOTH repositories. This update is prepared and tested locally; downloading it or pushing only the backend does not update the public form or add the confirmation pages.

## 1. Update your backend repository

Download the new `al-burhaniya-backend.zip` into Downloads. If your browser appends `(1)` to the filename, rename it to the filename below first. This archive contains `package.json` directly at its root.

In Terminal on your Mac:

```bash
cd "$HOME/Documents/Work/Ongoing/alburhaniya-backend"
git remote -v
git status --short
```

The origin should be `https://github.com/faheemdev1-gif/alburhaniya.git`. If you have your own uncommitted changes, preserve them before overwriting files. The archive does not contain `.git`, `.env`, `node_modules` or `dist`.

```bash
unzip -o "$HOME/Downloads/al-burhaniya-backend.zip" -d .
npm ci
npm test
git diff --stat
git add src scripts tests package.json package-lock.json tsconfig.json .node-version .gitignore .env.example README-CONTACT-FORM.md README-CONTENT-EDITOR.md README-NEWSLETTER.md
git commit -m "Add newsletter subscriptions and subscriber management"
git push origin main
```

In Hostinger, keep the GitHub backend repository above, branch `main`, root `./`, Node 22, the existing MongoDB connection, JWT secret and admin account settings. Use:

- Build command: `npm ci --include=dev --include=optional && npm run build`
- Start command: `npm start`

Check that the deployment containing your new commit completes. Use manual redeploy if automatic deployment is disabled.

## 2. Configure confirmation email on Hostinger

Use the SMTP account you already use for the contact form. No new image storage or newsletter API account is needed to collect and confirm subscribers. Set these in the BACKEND application's environment variables, then redeploy:

```dotenv
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=info@al-burhaniyainternational.co.uk
SMTP_PASS=YOUR_ACTUAL_MAILBOX_PASSWORD
CONTACT_FROM_EMAIL=info@al-burhaniyainternational.co.uk
CONTACT_TO_EMAIL=info@al-burhaniyainternational.co.uk
NEWSLETTER_FROM_EMAIL=info@al-burhaniyainternational.co.uk
NEWSLETTER_SITE_URL=https://al-burhaniyainternational.co.uk
```

Use the real mailbox's SMTP settings if it is hosted elsewhere; the example above assumes a Hostinger mailbox. `SMTP_PASS` is the mailbox's password. Your existing `JWT_SECRET` must remain set. Do not send passwords in chat, commit them to Git, or use `VITE_*` variables for SMTP secrets.

The newsletter sender falls back to `CONTACT_FROM_EMAIL`, then `SMTP_USER`, if `NEWSLETTER_FROM_EMAIL` is omitted. The website URL defaults to `https://al-burhaniyainternational.co.uk`; use an HTTPS origin without a path or credentials if you override it.

Without SMTP, a valid request is saved as **pending** and the form explicitly says confirmation is unavailable. It does not say the visitor is subscribed. After configuring SMTP, open Admin > Subscribers and resend the pending confirmation. SMTP acceptance does not guarantee inbox delivery; check spam and your mailbox provider's sender configuration if necessary.

## 3. Update your frontend repository

Download the new full `al-burhaniya-manchester.zip` into Downloads. The full archive has an `al-burhaniya-manchester/` top-level folder. The commands below copy the frontend into your existing frontend repository and leave its Git metadata and separate backend alone.

```bash
cd "$HOME/Documents/Work/Ongoing/al-burhaniya-manchester"
git remote -v
git status --short
```

The origin should be `https://github.com/faheemdev1-gif/alburhaniya-frontend.git`. Preserve any of your own uncommitted edits before copying the update.

```bash
unzip -o "$HOME/Downloads/al-burhaniya-manchester.zip" -d "$HOME/Downloads/newsletter-update"
rsync -av --exclude='server/' --exclude='.git/' "$HOME/Downloads/newsletter-update/al-burhaniya-manchester/" "$HOME/Documents/Work/Ongoing/al-burhaniya-manchester/"
npm ci
npm run build
git diff --stat
git add src scripts tests package.json package-lock.json README-NEWSLETTER.md
git commit -m "Connect newsletter form and add subscriber admin page"
git push origin main
```

In Vercel, set the frontend's production environment variable:

```dotenv
VITE_API_URL=https://peru-nightingale-490437.hostingersite.com/api
```

Deploy the new frontend commit. This variable must exist BEFORE the frontend build. Retain `vercel.json` so direct visits to `/newsletter/confirm` and `/newsletter/unsubscribe` load React. Do not stage the old frontend `server` gitlink as part of this update.

## 4. Verify the public website

1. Open `https://peru-nightingale-490437.hostingersite.com/api/health`. The response should include `newsletter.contract: "newsletter-v1"` and `newsletter.emailConfigured: true`.
2. Open `https://al-burhaniyainternational.co.uk/`, submit your own email in Stay in the Loop, and check the inbox/spam folder.
3. Open `https://al-burhaniyainternational.co.uk/admin/subscribers` as an administrator. The request should be pending initially.
4. Open the confirmation email link and select **Confirm subscription**. Refresh Subscribers; the address should now be confirmed.
5. Select **Export confirmed CSV**. Your confirmed address should be included.
6. Open the email's unsubscribe link and select **Unsubscribe**. Refresh Subscribers and export again; your address should be excluded.

A missing route / 404 means the relevant app has not deployed this update. A saved pending request with no email means SMTP is unavailable or failed. The UI keeps the email address on failure so it can be retried. Only administrators can view or manage subscriber data.

## Sending newsletters

This update makes SIGN-UP and subscriber management functional. It does not compose or automatically send the monthly newsletters themselves. Use your mailing service to send campaigns to the confirmed list, or request a campaign integration as a separate change.

The CSV includes `email`, `confirmed_at` and a per-subscriber `unsubscribe_url`. Include an unsubscribe link in each campaign and use a fresh export before sending so unsubscribed addresses are removed. If your mailing provider manages unsubscribes independently, its suppression list must also be respected; provider webhooks/synchronization are not part of this update. CSV cells are quoted and formula prefixes escaped for spreadsheet safety.

## Implementation and tests

Frontend:

- `src/components/home/NewsletterForm.tsx` and `src/pages/HomePage.tsx`: async newsletter form, busy state, accessible feedback and consent text.
- `src/pages/NewsletterActionPage.tsx` and `src/App.tsx`: deliberate confirmation and unsubscribe buttons.
- `src/admin/pages/SubscribersPage.tsx`, its CSS, admin router and navigation: protected subscriber management.

Backend:

- `src/models/NewsletterSubscriber.ts`: unique normalized email, consent state/timestamps and indexed hashed confirmation tokens.
- `src/services/newsletterNotification.ts`: SMTP confirmations, 48-hour token expiry, atomic mail claims, one-minute resend cooldown and signed unsubscribe links.
- `src/routes/newsletter.ts`: signup, confirmation, unsubscribe, protected listing/export and admin actions.
- `src/app.ts`, `src/server.ts`, `.env.example`: small JSON request limit, readiness contract and startup index creation.

The confirmation token is stored hashed. Token fragments do not appear in HTTP access logs or referrer headers. Opening a link alone does not change subscription state. Resubscribing after unsubscribe requires new confirmation; old confirmation links cannot restore consent. Signing secret changes invalidate existing unsubscribe links. Request rate limits are in memory per server process (and reset on restart); multiple backend instances need a shared limiter if deployed later.

Run `npm test` in the standalone backend: 55 tests covering uploads, contact, newsletter and donations. Run `npm test` in the full project's root for 13 frontend tests. To run browser flows from the FULL project, install the frontend and backend dependencies, install a Playwright Chromium browser (`npx playwright install chromium`), then use:

```bash
npm run test:newsletter:browser
npm run test:contact:browser
npm run test:images:browser
```

Browser tests call the real local Express routes with isolated database/SMTP fixtures. They do not send real email or modify the production database. A live mailbox round-trip still needs to be tested after deployment.
