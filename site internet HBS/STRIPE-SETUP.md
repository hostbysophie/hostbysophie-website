# Stripe + Mercury Setup Guide — Host By Sophie

## Step 1 — Stripe Account Settings

### 1.1 Business Info
1. Go to [dashboard.stripe.com/settings/account](https://dashboard.stripe.com/settings/account)
2. Set:
   - **Business name:** Host By Sophie
   - **Business type:** Individual or Company (depending on your Aruba registration)
   - **Country:** Aruba (AW) — if not available, use Netherlands Antilles or contact Stripe support
   - **Industry:** Travel & Vacation Rentals
   - **Website:** https://hostbysophie.com

### 1.2 Link Mercury Bank Account (Payouts)
1. Go to **Settings → Bank accounts and scheduling**
2. Click **+ Add bank account**
3. Enter your Mercury details:
   - **Routing number:** (found in Mercury → Account details)
   - **Account number:** (found in Mercury → Account details)
   - **Account type:** Checking
4. Stripe will send 2 micro-deposits (< $1) to verify — takes 1–2 business days
5. Once verified, set payout schedule: **Daily** or **Weekly** (recommended: Weekly)

### 1.3 Branding
1. Go to **Settings → Branding**
2. Upload your logo
3. Set brand color: `#0F4C5C` (Ocean)
4. Accent color: `#C9A961` (Gold)
5. This will appear on the Stripe Checkout page your guests see

### 1.4 Email Receipts
1. Go to **Settings → Emails**
2. Enable: **Successful payments** → sends automatic receipt to guest
3. Enable: **Refunds** → notify if you refund a deposit
4. Set your support email: `hostbysophie@gmail.com`

---

## Step 2 — Get Your API Keys

1. Go to [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys)
2. You'll see two keys:
   - **Publishable key:** `pk_live_xxxx…` (safe to share publicly)
   - **Secret key:** `sk_live_xxxx…` (**NEVER share this — keep it in Cloudflare only**)
3. Note both — you'll need the Secret key for Cloudflare

> ⚠️ During testing, use the **Test mode** keys (`pk_test_` / `sk_test_`) first.
> Switch to Live keys only when you're ready to accept real payments.

---

## Step 3 — Deploy the Cloudflare Worker

The file `functions/create-checkout.js` is the backend that creates Stripe sessions.

### Option A — Cloudflare Pages (if your site is on Pages)
1. The `functions/` folder is automatically deployed as a Pages Function
2. Go to **Cloudflare Pages → your project → Settings → Environment variables**
3. Add variable:
   - **Variable name:** `STRIPE_SECRET_KEY`
   - **Value:** `sk_live_xxxxxxxxxxxx` (your Stripe secret key)
4. Re-deploy your site (push to git or re-upload)
5. The endpoint will be live at: `https://hostbysophie.com/create-checkout`

### Option B — Cloudflare Workers (standalone)
1. Install Wrangler: `npm install -g wrangler`
2. Login: `wrangler login`
3. Create worker: `wrangler init hbs-payments`
4. Copy `functions/create-checkout.js` content into `src/index.js`
5. Add secret: `wrangler secret put STRIPE_SECRET_KEY`
6. Deploy: `wrangler deploy`
7. Update the fetch URL in `payment.html`:
   ```js
   const res = await fetch('https://hbs-payments.YOUR_SUBDOMAIN.workers.dev/create-checkout', { ... });
   ```

---

## Step 4 — Test Before Going Live

### 4.1 Test cards (use in Test mode)
| Card number         | Result       |
|---------------------|--------------|
| 4242 4242 4242 4242 | ✅ Success    |
| 4000 0000 0000 9995 | ❌ Declined   |
| 4000 0025 0000 3155 | 🔐 3D Secure  |

Use any future expiry (e.g. 12/28) and any 3-digit CVC.

### 4.2 Test flow
1. Open `payment.html` in browser
2. Fill in name, email, reference, amount, select type
3. Click "Proceed to secure checkout"
4. You should be redirected to a Stripe-hosted page
5. Enter a test card → payment succeeds
6. You should be redirected to `payment-success.html`
7. Check Stripe dashboard → Payments → you should see the test payment

---

## Step 5 — Go Live Checklist

- [ ] Stripe account fully verified (business info + ID submitted)
- [ ] Mercury bank account linked and verified in Stripe
- [ ] Branding set (logo + colors)
- [ ] `STRIPE_SECRET_KEY` set to **live** key in Cloudflare (not test)
- [ ] Success/cancel URLs updated to `https://hostbysophie.com/...`
- [ ] Tested end-to-end with test cards
- [ ] Stripe webhook configured (optional but recommended for notifications)

---

## Optional — Stripe Webhooks (notifications)

Set up a webhook to be notified when a payment succeeds:
1. Go to **Stripe → Developers → Webhooks → + Add endpoint**
2. Endpoint URL: `https://hostbysophie.com/webhook` (requires additional Worker)
3. Events to listen for:
   - `payment_intent.succeeded`
   - `checkout.session.completed`
4. This lets you auto-send a custom email, update a spreadsheet, etc.

---

## Support

- Stripe support: [support.stripe.com](https://support.stripe.com)
- Mercury support: [mercury.com/help](https://mercury.com/help)
- Site help: hostbysophie@gmail.com
