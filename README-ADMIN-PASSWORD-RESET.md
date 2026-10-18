# Admin password recovery

Deploy **both** the backend to Hostinger and the frontend to Vercel. The complete
archives include previous changes, including the simplified footer.

## Hostinger settings

Keep your existing MongoDB URI, JWT secret and working SMTP settings. Add:

```dotenv
ADMIN_SITE_URL=https://www.alburhaniyainternational.org.uk
```

This is the frontend origin used in reset emails. It defaults to the address
above. Do not append `/admin`, a path, query string or trailing fragment.

Password recovery uses the same SMTP account as the website notifications.
If you use Resend, the settings are:

```dotenv
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASS=<your Resend API key>
CONTACT_FROM_EMAIL=info@alburhaniyainternational.org.uk
```

The sender falls back from `EVENT_FROM_EMAIL` to `CONTACT_FROM_EMAIL`. Keep both
set to an address on your verified sending domain if you already use both.
Enter the API key directly in Hostinger, never in the frontend or a public file.
You do not need to configure Hostinger mailbox SMTP if you are using Resend.

Build: `npm ci && npm run build`. Start: `npm start`. Keep Node 22 or newer.
No account recreation, seed command, JWT secret change or manual database
migration is needed. Existing accounts gain reset fields when requested.

## How it works

1. Open `https://www.alburhaniyainternational.org.uk/admin/login`.
2. Choose **Forgot password?** and enter the email saved on that admin account.
3. Open the email and choose a password, then confirm it.
4. Return to sign in and use the new password.

The email goes to the account's registered email, which is not necessarily the
main website inbox. `ADMIN_EMAIL` is used by the initial seeding script; changing
that environment value does not rename an existing account. If the registered
mailbox is inaccessible, another authorised administrator must arrange an account
email correction. This feature does not bypass mailbox ownership.

Reset links expire after 15 minutes and work once. Requesting a link does not
change the password or sign anyone out. Completing a reset revokes that account's
previous sessions and requires normal sign-in. An email also confirms the change.

Use at least 8 characters, with a maximum of 72 UTF-8 bytes to avoid bcrypt
truncation. The form asks for matching password confirmation. The reset token is
random, stored as a SHA-256 hash and delivered in the URL fragment. The form
removes it from the address bar and keeps it only in memory. If you refresh the
form, reopen the email link. Opening the link alone does not consume it.

Requests receive the same public acknowledgement for known and unknown accounts.
Repeated requests are limited per email/IP, with a persisted 60-second email
cooldown. Use the latest email if you request more than one link. A 429 response
means wait 15 minutes. These IP counters are process-local; the account cooldown
persists across restarts. Behind a proxy, IP limits may be shared because the
server does not trust arbitrary forwarding headers.

## Check after deployment

Open `https://peru-nightingale-490437.hostingersite.com/api/health`. It should show:

```json
"passwordReset": {
  "contract": "admin-password-reset-v1",
  "emailConfigured": true
}
```

`emailConfigured` verifies settings are present and valid; it does not prove inbox
delivery. Request a reset for your own account and check inbox/spam and Resend
delivery logs. After resetting, confirm the new password signs in, the old one
fails, and reusing the link fails. If the recovery route is missing, deploy the
backend update. If the email is unavailable, check SMTP configuration. A generic
acknowledgement cannot confirm that an account exists or that mail was delivered;
SMTP/database failures are logged without reset tokens or private credentials.

## Validation

84 backend tests and 13 frontend tests. Browser tests exercise the real Express
auth routes with an isolated database fixture and SMTP transport: recovery email,
password matching, storage/delivery errors, expired/used tokens, session revocation
and successful sign-in with the new password. No production account was changed
and no real email was sent during these tests.

Run the browser suite from the frontend with Chromium installed:
`npm run test:password-reset:browser`.
