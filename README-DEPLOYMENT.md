Latest settings: see `README-DOMAIN-UPDATE.md` and `HOSTINGER-DOMAIN-UPDATE.env` for the new domain and mailbox.

# Donation, notifications and event registration update — 14 October 2026

Both projects must be deployed. These archives do not deploy themselves.

## What has been fixed

- `/donate` and `/donation` now open a dedicated donation page. The existing homepage and floating donation widget share the amount selection. Stripe Checkout receives the exact selected GBP amount, including custom amounts; the return page verifies payment with Stripe before showing success.
- Contact enquiries save in MongoDB and Admin > Messages. Email notifications use the main mailbox.
- Every subscribe banner now calls the real newsletter API. The visitor receives a confirmation link. After confirming, their address appears in Admin > Subscribers and the main mailbox receives a new-subscriber notification. This does not automatically send monthly newsletter campaigns.
- Event registrations now save the attendee's name, email, optional phone, notes and number of places. The attendee details and reserved count are saved in the same atomic MongoDB update to prevent overbooking. Duplicate retries do not create extra places. Past events, invalid forms and insufficient capacity are rejected.
- Registration information is emailed to the main mailbox. A separate event confirmation goes to the attendee. View records and email status in Admin > Events > Registrations. Failed/disabled emails can be retried by an administrator.
- Event loading errors show a retry control rather than a misleading empty events list. The event date is evaluated in the Europe/London timezone.

Main mailbox: **info@alburhaniyainternational.org.uk**.

## Current live status

A read-only check of the deployed backend on 14 October 2026 returned:

- `contact.emailConfigured: false`
- `newsletter.emailConfigured: false`
- `donations.configured: false`
- no event-registration contract (the new backend has not yet been deployed)

These are configuration checks, not proof of delivered emails or completed payments.

## 1. Configure the backend on Hostinger

Keep the existing MongoDB URI, JWT secret and account settings. Add these environment variables:

```dotenv
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=info@alburhaniyainternational.org.uk
SMTP_PASS=<the mailbox SMTP password>
CONTACT_FROM_EMAIL=info@alburhaniyainternational.org.uk
CONTACT_TO_EMAIL=info@alburhaniyainternational.org.uk
NOTIFICATION_TO_EMAIL=info@alburhaniyainternational.org.uk
EVENT_FROM_EMAIL=info@alburhaniyainternational.org.uk
EVENT_TO_EMAIL=info@alburhaniyainternational.org.uk
NEWSLETTER_FROM_EMAIL=info@alburhaniyainternational.org.uk
NEWSLETTER_SITE_URL=https://www.alburhaniyainternational.org.uk
DONATION_SITE_URL=https://www.alburhaniyainternational.org.uk
STRIPE_SECRET_KEY=<the organisation's Stripe server key>
```

The SMTP host/port assume the mailbox is hosted by Hostinger. Use the actual provider settings otherwise. Enter secrets directly in Hostinger; do not add them to frontend `VITE_*` values or commit them.

Use the Stripe account that owns the organisation's existing donation button. A public `pk_...` key or `buy_btn_...` ID cannot create the selected-amount server Checkout Session. Test with `sk_test_...` first; use `sk_live_...` when ready for real donations. No private Stripe key or SMTP password was included in these uploaded projects, so those credentials were not fabricated or added.

From the backend repository:

```bash
npm ci
npm test
npm run build
```

Hostinger build: `npm ci && npm run build`

Hostinger start: `npm start`

Node: 22 or newer. Deploy the standalone `alburhaniya-backend` project to Hostinger. The frontend archive's `server` folder is a synchronized copy for local tests; it is not a second production backend.

## 2. Deploy the frontend on Vercel

Copy the frontend project changes into the existing frontend checkout. Preserve your `.git` directory. Do not add the old `server` gitlink to the frontend commit.

Vercel environment variable:

```dotenv
VITE_API_URL=https://peru-nightingale-490437.hostingersite.com/api
```

Then build and deploy the frontend:

```bash
npm ci
npm run build
npm test
```

Keep `vercel.json` so direct visits to donation and newsletter return pages load React.

## 3. Verify the live deployment

Open `https://peru-nightingale-490437.hostingersite.com/api/health` and check:

```json
{
  "contact": { "emailConfigured": true },
  "newsletter": { "contract": "newsletter-v2", "emailConfigured": true, "adminEmailConfigured": true },
  "events": { "contract": "event-registration-v1", "emailConfigured": true },
  "donations": { "contract": "donation-checkout-v1", "configured": true }
}
```

1. Submit a contact enquiry using your own email. Confirm the saved Admin > Messages record and arrival in the main mailbox.
2. Subscribe on an event page using your own email. Confirm through the emailed link. Check Admin > Subscribers and the main-mailbox notification. Unconfirmed addresses remain pending.
3. Create an upcoming event with positive capacity, then reserve two places. Check Admin > Events > Registrations, the reserved count, organiser notification and attendee confirmation. Repeating the same submission must not add places.
4. In Stripe test mode, select a custom donation such as £73.17. Check the same amount in Checkout, complete a test payment, and verify the return page. Cancelling must not display payment success. Switch to the live key only after this check.

Saved registrations remain available even if SMTP fails. “Sent” means the SMTP server accepted the email; verify inbox/spam delivery yourself. Old fake registrations made before this update cannot be recovered because no attendee details were saved. Existing reserved counts are preserved.

Event registration does not take ticket payments. A paid event clearly says that the organiser handles payment separately. Set event capacity to a positive number to accept registrations. Deleting an event also removes its attendee list; the delete dialog now states this.

## Validation included

Both TypeScript builds passed. The backend suite contains 66 tests and the frontend suite 13 tests. External Stripe/SMTP calls and database operations in tests use isolated responses/fixtures; the tests do not charge cards, email people or change the production database.

Browser checks cover exact donation totals and returns, actual registration payloads, failure/retry, capacity updates, mobile layout and all four inner-page subscription banners. Run the browser checks on a machine with Playwright Chromium installed:

```bash
npx playwright install chromium
npm run test:donation:browser
npm run test:newsletter:browser
npm run test:events:browser
```

No live payment or mailbox round-trip has been claimed. The final live checks require the credentials and deployment above.
