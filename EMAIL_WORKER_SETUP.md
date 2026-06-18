# Brevo Email Worker Setup

This removes email sending from Firebase Functions. Firestore and Firebase Auth stay the same.

## Files

- Worker code: `cloudflare-worker/email-worker.js`
- Frontend endpoint setting: `EMAIL_API_ENDPOINT` inside `admin-dashboard.js`

## Cloudflare Worker Setup

1. Open Cloudflare Dashboard.
2. Go to `Workers & Pages`.
3. Create a new Worker.
4. Paste the code from `cloudflare-worker/email-worker.js`.
5. Go to `Settings > Variables`.
6. Add these environment variables:

```txt
BREVO_API_KEY=your Brevo API key
BREVO_SENDER_EMAIL=bookings@your-real-domain.com
BREVO_SENDER_NAME=Gloss Boss Detailing
BREVO_REPLY_TO_EMAIL=your-inbox@your-real-domain.com
APP_URL=https://braazbedat10205-blip.github.io
EMAIL_LOGO_URL=https://braazbedat10205-blip.github.io/gloss-boss-detailin2/glos.jpeg
FIREBASE_PROJECT_ID=gloos-boos-site
```

Do not put the Brevo API key in any HTML or JavaScript frontend file.
The sender must be a real address on a domain authenticated in Brevo. The Worker
rejects placeholder domains such as `your-domain.com`.

7. Deploy the Worker.
8. Copy the Worker URL, for example:

```txt
https://gloss-boss-email.yourname.workers.dev
```

9. Put that URL in `admin-dashboard.js`:

```js
const EMAIL_API_ENDPOINT = "https://gloss-boss-email.yourname.workers.dev";
```

## Deploy From Terminal

The project includes `cloudflare-worker/wrangler.toml`.

Cloudflare requires a Cloudflare API token for terminal deployment in this environment. The Brevo API key is only for sending emails and cannot deploy the Worker.

1. Create a Cloudflare API token from:
   `Cloudflare Dashboard > My Profile > API Tokens > Create Token`
2. Use a token that can edit Workers for this account.
3. In PowerShell, run:

```powershell
$env:CLOUDFLARE_API_TOKEN="your-cloudflare-api-token"
cd cloudflare-worker
npx wrangler deploy
```

4. Add the Brevo key as a Worker secret:

```powershell
npx wrangler secret put BREVO_API_KEY
```

Paste the Brevo API key only when Wrangler asks for it. Do not save it in code.

## Example Request From Frontend

```js
await fetch(EMAIL_API_ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    type: "booking-confirmation",
    to: booking.userEmail,
    booking: {
      customerName: booking.customerName,
      service: booking.service,
      date: booking.date,
      time: booking.time,
      vehicle: booking.vehicle,
    },
  }),
});
```

Cancellation:

```js
await fetch(EMAIL_API_ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    type: "booking-cancellation",
    to: booking.userEmail,
    booking,
  }),
});
```

Password reset:

```js
await fetch(EMAIL_API_ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    type: "password-reset",
    to: email,
    resetLink,
  }),
});
```

Important: Firebase client SDK cannot generate a password reset link without sending Firebase's own email. A custom Brevo reset email needs a trusted backend that can generate `resetLink` with Firebase Admin SDK. The Worker template supports `password-reset` once you provide a secure reset link.

## Brevo Deliverability

Inside Brevo, authenticate the entire sender domain, not only one sender address,
and add every SPF, DKIM, and DMARC record shown by Brevo to your DNS.

Also check the following:

1. Brevo must show the domain as authenticated.
2. Use only one SPF record for the domain. Merge providers into that record
   instead of adding multiple `v=spf1` records.
3. Start DMARC with monitoring, for example:
   `v=DMARC1; p=none; rua=mailto:dmarc@your-real-domain.com`
4. Do not use Gmail, Outlook, or another free mailbox as `BREVO_SENDER_EMAIL`.
5. Keep the Worker authorization check enabled. A public email endpoint can be
   abused and quickly damage the sender reputation.

After changing Worker variables or code, deploy it again. Existing messages that
already landed in spam do not retrain Gmail immediately; mark a few legitimate
test messages as "Not spam" while the authenticated domain builds reputation.

`wrangler.toml` uses `keep_vars = true` so deployment preserves the real sender
configured in the Cloudflare dashboard instead of overwriting it with an example.
