# Firebase Setup

Firestore and Auth stay in Firebase. Email sending is handled by the Cloudflare Worker in `cloudflare-worker/email-worker.js`, so Firebase Billing is not needed for email.

## Admin Access

1. Enable `Email/Password` from `Firebase Console > Authentication > Sign-in method`.
2. Create the shop owner account from `login.html`.
3. Open `Firestore Database > admins`.
4. Add a document where the document ID is the owner's Firebase Auth `UID`.
5. Any user that does not have a document in `admins/{uid}` cannot open `admin.html`.

## Firebase Rules

Deploy or publish these files before launch:

```bash
firebase deploy --only firestore:rules,storage
```

- Firestore rules file: `firestore.rules`
- Storage rules file: `storage.rules`

Current rules allow public product reads, but only admins can create, edit, or delete products.

## Email Worker

Use `EMAIL_WORKER_SETUP.md` for the Brevo + Cloudflare Worker setup.

After deploying the Worker, put its URL in `admin-dashboard.js`:

```js
const EMAIL_API_ENDPOINT = "https://your-worker-name.your-account.workers.dev";
```

The Brevo API key goes only in Cloudflare Worker environment variables, never in frontend files.

## Storage CORS

If product uploads use Firebase Storage and you see a CORS preflight error, apply `cors.json` to the bucket:

```bash
gcloud storage buckets update gs://gloos-boos-site.firebasestorage.app --cors-file=cors.json
```

Older tool:

```bash
gsutil cors set cors.json gs://gloos-boos-site.firebasestorage.app
```

Current note: `admin-dashboard.js` is set to save compressed WebP images as Firestore data URLs, not Storage uploads. This avoids CORS, but it is only suitable for small optimized product images. For many products, switch `PRODUCT_IMAGE_MODE` back to `firebase-storage` after CORS is applied.

## Booking Flow Test

Before publishing:

1. Create a test user.
2. Make a booking from `Reservations.html`.
3. Confirm it from `admin.html`.
4. Cancel another booking and verify the time slot opens again.
5. Complete another booking and verify it disappears from the active list.
6. Check that the confirmation/cancellation email arrives from Brevo.
