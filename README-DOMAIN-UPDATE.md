# New website domain and mailbox — 16 October 2026

Website: https://www.alburhaniyainternational.org.uk

Mailbox: info@alburhaniyainternational.org.uk

Both codebases are updated. These are complete project archives with the earlier homepage events correction included.

## Deploy BOTH projects

1. Extract the frontend archive. Copy the contents of `al-burhaniya-manchester` into your existing frontend repository, replace matching files, and deploy on Vercel. Preserve your `.git` directory and local environment settings. Do not add the frontend `server` mirror as a new submodule.
2. Extract the backend archive. Copy the contents of `alburhaniya-backend` into your existing backend repository, replace matching files, and deploy on Hostinger. Preserve your `.git` directory and local secrets.
3. In Hostinger, update the environment variables listed in `HOSTINGER-DOMAIN-UPDATE.env`. Those explicit hosting settings override code defaults, so deploying source alone does not update values that were already configured.
4. Set `SMTP_PASS` separately to the password for the new mailbox. The supplied settings file contains no password or Stripe key. Its SMTP host/port assume Hostinger Email; use your actual mailbox provider's settings otherwise.
5. Keep the existing MongoDB URI, JWT secret, Stripe secret key and administrator account settings. Apply the settings changes and restart/redeploy the backend.
6. Vercel `VITE_API_URL` continues to use the existing backend: `https://peru-nightingale-490437.hostingersite.com/api`. Ensure the new frontend domain is attached to your Vercel project.

## Changes included

- New public contact email in the frontend defaults and any saved legacy CMS content loaded by the frontend.
- Public CMS responses translate the former email/domain to the new identity without changing unrelated content or writing to MongoDB during reads.
- Backend CORS allows both `https://www.alburhaniyainternational.org.uk` and `https://alburhaniyainternational.org.uk`, plus the existing frontend Vercel deployment and local development.
- Stripe donation success/cancellation links use the new canonical www domain by default.
- Newsletter confirmation/unsubscribe links use the new domain by default.
- Event organiser and confirmed-subscriber notifications default to the new mailbox. Sender/recipient settings in the hosting environment must also use the new mailbox.
- Existing event registration, donation amount selection, homepage event visibility and admin management fixes are retained.

The public backend was checked before this update was deployed. It did not return `Access-Control-Allow-Origin` for requests from the new www domain; deploying the backend is necessary to fix that browser access issue. No live configuration, email or payment was changed by preparing these files.

## Verify after deployment

- Open the new website and check that Upcoming Events loads, including the 21 October event if it remains upcoming.
- Check the public contact email and mailto link.
- Submit a contact form using your own email, then check the saved message and the new main mailbox/spam folder.
- Subscribe, confirm using the emailed link on the new domain, and check Admin > Subscribers and the owner notification.
- Reserve an event place and check Admin > Events > Registrations and the organiser/attendee emails.
- In Stripe test mode, check that checkout returns to the new website and shows the selected amount.

Both builds, 70 backend tests and 13 frontend tests passed during preparation. Browser checks use isolated payment/mail responses and do not send real emails, charge cards or modify production data. Final live inbox/payment verification requires deployment and real credentials.
