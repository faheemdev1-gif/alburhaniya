# Selected-amount donation widget

The donation section now has £10, £25, £50, £100, £250 and £500 buttons, plus a custom amount. Choosing an amount updates the displayed total and Donate button immediately. The homepage and floating donation window share the same selection, and the browser remembers it during the current tab's session.

The former Stripe Buy Button embed was replaced by a styled donation card connected to server-created Stripe Checkout. Adding amount buttons outside the old embed would not change its price: the documented Buy Button attributes do not include a donation amount. This update passes the selected amount to Stripe so the checkout amount matches the widget.

**Deploy both the frontend and backend, and set a Stripe server key in Hostinger.** The source and automated tests are ready; the public website and real payment acceptance are not changed by downloading these archives.

## What works

- Six preset amounts matching your screenshot; £10 selected initially.
- Custom one-time donations between £1.00 and £10,000.00, with at most two decimal places.
- Exact GBP totals calculated in integer pence. For example, £73.17 becomes 7,317 pence.
- A secure Stripe-hosted checkout collecting payment details.
- Locked controls while checkout opens, useful error messages and preserved selections on failure.
- A return page that checks the session with Stripe. It shows a confirmed payment only when Stripe reports a completed, paid donation.
- Checkout cancellation does not show a payment success message.
- Existing image, contact and newsletter changes are retained.

This is a one-time donation flow, as in your screenshot. It does not create monthly subscriptions, collect Gift Aid declarations or add a donation ledger in the admin area. Payments, refunds and receipts are managed in the Stripe account. The application has no fulfillment action requiring a webhook; if an admin payment ledger or automatic processing is added later, verified Stripe webhooks should be added for that feature.

## 1. Add the Stripe key on Hostinger

Use the SAME organisation's Stripe account that owns your current donation button. No new Stripe account is required if you have access to that account.

1. Open the Stripe Dashboard: https://dashboard.stripe.com/apikeys .
2. First use a sandbox/test server key (`sk_test_...`) to verify the payment flow. A `pk_...` publishable key or `buy_btn_...` button ID cannot create server-side Checkout Sessions.
3. In Hostinger, open the backend Node.js application's environment variables. Add:

```dotenv
STRIPE_SECRET_KEY=YOUR_STRIPE_SERVER_KEY
DONATION_SITE_URL=https://al-burhaniyainternational.co.uk
```

4. Keep your existing MongoDB, JWT, image storage and SMTP variables.
5. Deploy the new backend commit below.
6. After sandbox verification, replace the key with the organisation's live server key (`sk_live_...`) and redeploy to accept real payments.

Restricted server keys (`rk_test_...` / `rk_live_...`) are also supported when granted the permissions needed for this Checkout integration, including session creation/retrieval and inline prices/products. Stripe recommends restricted keys where possible. Use the key only in the backend environment. Do not put it in source files, Git, chat or a `VITE_*` frontend variable.

The integration pins Stripe API version `2025-06-30.basil`. It creates a single GBP line item at the selected amount, quantity one, using payment mode and the donation button label. Adaptive Pricing is disabled so the checkout retains GBP. Card payments are enabled; any wallet options shown by Stripe depend on the account, browser and eligibility. The widget does not claim that every payment method is available.

## 2. Update and push the backend

Download the latest `al-burhaniya-backend.zip` to Downloads. Rename it to that filename if your browser adds `(1)` or another suffix. Its `package.json` is directly at the ZIP root.

Run in your Mac Terminal:

```bash
cd "$HOME/Documents/Work/Ongoing/alburhaniya-backend"
git remote -v
git status --short
```

The origin should be `https://github.com/faheemdev1-gif/alburhaniya.git`. Preserve any of your own uncommitted edits before overwriting files. The archive contains no `.git`, `.env`, `node_modules` or `dist`.

```bash
unzip -o "$HOME/Downloads/al-burhaniya-backend.zip" -d .
npm ci
npm test
git diff --stat
git add src scripts tests package.json package-lock.json tsconfig.json .node-version .gitignore .env.example README-CONTACT-FORM.md README-CONTENT-EDITOR.md README-NEWSLETTER.md README-DONATIONS.md
git commit -m "Add selected-amount Stripe donation checkout"
git push origin main
```

In Hostinger, retain the backend repository above, branch `main`, root `./`, Node 22 and your existing application port settings. Use:

- Build: `npm ci --include=dev --include=optional && npm run build`
- Start: `npm start`

Wait for the new backend commit to finish deploying. Manually redeploy if automatic deployment is disabled.

## 3. Update and push the frontend

Download the latest full `al-burhaniya-manchester.zip` to Downloads. It has an `al-burhaniya-manchester/` top-level folder.

```bash
cd "$HOME/Documents/Work/Ongoing/al-burhaniya-manchester"
git remote -v
git status --short
```

The origin should be `https://github.com/faheemdev1-gif/alburhaniya-frontend.git`. Preserve any of your own uncommitted edits first.

```bash
unzip -o "$HOME/Downloads/al-burhaniya-manchester.zip" -d "$HOME/Downloads/donation-update"
rsync -av --exclude='server/' --exclude='.git/' "$HOME/Downloads/donation-update/al-burhaniya-manchester/" "$HOME/Documents/Work/Ongoing/al-burhaniya-manchester/"
npm ci
npm run build
git diff --stat
git add src scripts tests index.html package.json package-lock.json README-DONATIONS.md README-NEWSLETTER.md
git commit -m "Add donation amounts and connect the live total to Stripe"
git push origin main
```

If `src/stripe-buy-button.d.ts` remains from your old copy, it is now unused and can be removed; the `rsync` command preserves old files intentionally, and that declaration does not affect the new widget. The new `index.html` removes the old Stripe Buy Button script, so include `index.html` in the commit as above.

Set this production environment variable in Vercel BEFORE the frontend build:

```dotenv
VITE_API_URL=https://peru-nightingale-490437.hostingersite.com/api
```

Retain `vercel.json` so `/donation/return` loads the React application. Deploy the frontend commit. Do not add the old `server` gitlink to the frontend commit.

## 4. Verify the deployed flow

1. Open `https://peru-nightingale-490437.hostingersite.com/api/health`. Look for `donations.contract: "donation-checkout-v1"` and `donations.configured: true`. This checks configuration shape, not connectivity or key permissions.
2. Open the website donation section. Select all six presets and check that the total and Donate button change.
3. Enter a custom amount such as `73.17`. The widget should show `£73.17`.
4. With a sandbox/test key configured, select Donate. The Stripe checkout should show GBP £73.17. Use Stripe's documented test card details: https://docs.stripe.com/testing . Do not use real card details in a sandbox.
5. Cancel checkout and verify there is no confirmed-payment message. The selected amount should be retained when returning to the form in the same tab.
6. Complete a sandbox payment and verify the return page checks Stripe and displays the confirmed amount. Check the corresponding session/payment in the Stripe sandbox Dashboard.
7. Replace the backend server key with the correct live key and redeploy when ready to accept real donations.

A 404 from `/api/donations/checkout` means the backend update has not deployed. “Online donations are not configured yet” means the backend server key or site URL is missing/invalid. “Secure checkout is temporarily unavailable” can indicate a revoked key, insufficient permissions or an upstream error; use Stripe Workbench request logs to diagnose it. The application does not expose raw Stripe errors or keys to visitors.

There have been no real charges in the included automated tests. A sandbox round-trip in your Stripe account is still required before enabling live payment acceptance.

## Changed files

Frontend:

- `src/components/DonationWidget.tsx` and `.css`: amount choices, custom input, total and checkout button.
- `src/context/DonationContext.tsx`: shared selection, tab-session persistence and checkout submission.
- `src/services/donationAmount.ts`: exact GBP amount parsing.
- `src/components/StripeBuyButton.tsx`: existing entry point now renders the donation card.
- `src/components/FloatingStripeButton.tsx` and `.css`: same widget in the floating modal with keyboard focus handling.
- `src/pages/HomePage.tsx`: removes the unused pretend donation form and fixes the widget's nested grid width.
- `src/pages/DonationReturnPage.tsx` and `src/App.tsx`: verified payment return page and provider.
- `index.html`: removes the obsolete Stripe Buy Button script.

Backend:

- `src/services/stripeCheckout.ts`: server-side Stripe requests, fixed GBP checkout, bounded amounts, safe redirect validation and session verification.
- `src/routes/donations.ts`: public checkout creation and minimal session status API, small request limit and rate limiting.
- `src/app.ts` and `.env.example`: route mounting, health contract and key setup.

Server secrets stay in Hostinger. Success/cancel URLs, currency and quantity are fixed by the server; request-supplied alternatives are ignored. The UUID request ID is passed as a Stripe idempotency key so a retry of the same attempt reuses the session. A return query parameter alone cannot confirm payment. Payment status responses contain no donor or card details. Rate limits are per process and do not trust client-supplied forwarding headers; if the backend is scaled, use a shared limiter and configure trusted proxy addresses explicitly.

## Tests

- Root `npm test`: 13 tests, including exact custom-amount parsing and the existing image checks.
- Backend `npm test`: 55 tests, including checkout validation, all preset/custom amounts, Stripe failures, idempotency and verified payment status, plus contact, newsletter and image tests.
- Both applications build successfully.

From the FULL project, install both apps' dependencies and a Playwright browser (`npx playwright install chromium`), then run:

```bash
npm run test:donation:browser
npm run test:newsletter:browser
npm run test:contact:browser
npm run test:images:browser
```

The donation browser test uses actual local Express routes with isolated Stripe responses. It verifies preset/custom selection, shared modal state, keyboard focus, mobile sizing, busy controls, amount preservation, redirect totals, cancellation, unpaid/paid status and upstream failures. It sends no real payment requests.

Official references:

- Buy Button attributes: https://docs.stripe.com/payment-links/buy-button
- Checkout Sessions: https://docs.stripe.com/api/checkout/sessions/create
- Idempotency: https://docs.stripe.com/api/idempotent_requests
- API keys: https://docs.stripe.com/keys
