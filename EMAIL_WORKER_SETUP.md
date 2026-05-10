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
BREVO_SENDER_EMAIL=bookings@your-domain.com
BREVO_SENDER_NAME=Gloss Boss Detailing
APP_URL=https://gloos-boos-site.firebaseapp.com
```

Do not put the Brevo API key in any HTML or JavaScript frontend file.

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

Inside Brevo, verify the sender/domain and add SPF, DKIM, and DMARC records to your DNS. This is what reduces spam.
