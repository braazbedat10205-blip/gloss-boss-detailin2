const BREVO_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";
const FIREBASE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const RESET_REQUEST_WINDOW_MS = 60_000;
const recentResetRequests = new Map();
let cachedFirebaseAccessToken = null;

export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, corsHeaders);
    }

    if (!env.BREVO_API_KEY || !isValidSenderEmail(env.BREVO_SENDER_EMAIL)) {
      return json({ ok: false, error: "BREVO_NOT_CONFIGURED" }, 500, corsHeaders);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: "INVALID_JSON" }, 400, corsHeaders);
    }

    const type = String(payload?.type || "").trim();
    if (type === "password-reset-request") {
      if (!isAllowedOrigin(request, env)) {
        return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403, corsHeaders);
      }

      const result = await handlePasswordResetRequest(request, payload, env);
      return json(result.body, result.status, corsHeaders);
    }

    const authorization = await authorizeAdmin(request, env);
    if (!authorization.ok) {
      return json(authorization, authorization.status || 401, corsHeaders);
    }

    const email = buildEmail(payload, env);
    if (!email.ok) {
      return json(email, 400, corsHeaders);
    }

    const brevoResult = await sendBrevoEmail(email, env);
    if (!brevoResult.ok) {
      return json(
        {
          ok: false,
          error: "BREVO_SEND_FAILED",
          status: brevoResult.status,
          details: brevoResult.details,
        },
        502,
        corsHeaders,
      );
    }

    return json({ ok: true, type: email.type }, 200, corsHeaders);
  },
};

async function handlePasswordResetRequest(request, payload, env) {
  const email = String(payload?.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return { status: 400, body: { ok: false, error: "VALID_EMAIL_REQUIRED" } };
  }

  if (!isFirebaseServiceAccountConfigured(env)) {
    return { status: 500, body: { ok: false, error: "FIREBASE_ADMIN_NOT_CONFIGURED" } };
  }

  const clientAddress = request.headers.get("CF-Connecting-IP") || "unknown";
  const requestKey = `${clientAddress}:${email}`;
  if (isResetRequestRateLimited(requestKey)) {
    return { status: 200, body: genericResetResponse() };
  }

  recentResetRequests.set(requestKey, Date.now());

  let firebaseLink;
  try {
    firebaseLink = await generateFirebasePasswordResetLink(email, env);
  } catch (error) {
    const code = String(error?.code || "");
    if (code === "EMAIL_NOT_FOUND" || code === "USER_NOT_FOUND") {
      return { status: 200, body: genericResetResponse() };
    }

    console.error("Firebase reset link generation failed:", code || error);
    return { status: 503, body: { ok: false, error: "PASSWORD_RESET_UNAVAILABLE" } };
  }

  const resetLink = buildBrandedResetLink(firebaseLink, env);
  const emailMessage = buildEmail({
    type: "password-reset",
    to: email,
    resetLink,
  }, env);
  const sendResult = await sendBrevoEmail(emailMessage, env);

  if (!sendResult.ok) {
    console.error("Brevo password reset send failed:", sendResult.status, sendResult.details);
    return { status: 503, body: { ok: false, error: "PASSWORD_RESET_UNAVAILABLE" } };
  }

  return { status: 200, body: genericResetResponse() };
}

function genericResetResponse() {
  return {
    ok: true,
    message: "If an account exists for this email, a reset link has been sent.",
  };
}

function isResetRequestRateLimited(key) {
  const now = Date.now();
  const previousRequest = recentResetRequests.get(key) || 0;

  for (const [storedKey, timestamp] of recentResetRequests) {
    if (now - timestamp > RESET_REQUEST_WINDOW_MS) {
      recentResetRequests.delete(storedKey);
    }
  }

  return now - previousRequest < RESET_REQUEST_WINDOW_MS;
}

async function generateFirebasePasswordResetLink(email, env) {
  const accessToken = await getFirebaseAccessToken(env);
  const projectId = encodeURIComponent(env.FIREBASE_PROJECT_ID);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:sendOobCode`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-goog-user-project": env.FIREBASE_PROJECT_ID,
      },
      body: JSON.stringify({
        requestType: "PASSWORD_RESET",
        email,
        returnOobLink: true,
      }),
    },
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.oobLink) {
    const error = new Error("FIREBASE_RESET_LINK_FAILED");
    error.code = data?.error?.message || `HTTP_${response.status}`;
    throw error;
  }

  return data.oobLink;
}

function buildBrandedResetLink(firebaseLink, env) {
  const source = new URL(firebaseLink);
  const target = new URL(
    env.PASSWORD_RESET_URL || "https://gloos-boos-site.web.app/auth-action.html",
  );

  for (const key of ["mode", "oobCode", "apiKey", "lang", "continueUrl"]) {
    const value = source.searchParams.get(key);
    if (value) {
      target.searchParams.set(key, value);
    }
  }

  return target.toString();
}

async function getFirebaseAccessToken(env) {
  if (
    cachedFirebaseAccessToken
    && cachedFirebaseAccessToken.expiresAt > Date.now() + 60_000
  ) {
    return cachedFirebaseAccessToken.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = await signServiceAccountJwt({
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY,
    issuedAt: now,
  });

  const response = await fetch(FIREBASE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    throw new Error(`FIREBASE_TOKEN_FAILED_${response.status}`);
  }

  cachedFirebaseAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return cachedFirebaseAccessToken.token;
}

async function signServiceAccountJwt({ clientEmail, privateKey, issuedAt }) {
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64UrlEncode(JSON.stringify({
    iss: clientEmail,
    sub: clientEmail,
    aud: FIREBASE_TOKEN_URL,
    scope: "https://www.googleapis.com/auth/identitytoolkit",
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsignedToken = `${header}.${claims}`;
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken),
  );

  return `${unsignedToken}.${base64UrlEncode(signature)}`;
}

function pemToArrayBuffer(value) {
  const normalized = String(value || "").replaceAll("\\n", "\n");
  const base64 = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

function base64UrlEncode(value) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function isFirebaseServiceAccountConfigured(env) {
  return Boolean(
    env.FIREBASE_PROJECT_ID
    && env.FIREBASE_CLIENT_EMAIL
    && env.FIREBASE_PRIVATE_KEY,
  );
}

async function sendBrevoEmail(email, env) {
  const response = await fetch(BREVO_EMAIL_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": env.BREVO_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: getSender(env),
      to: [{ email: email.to }],
      subject: email.subject,
      textContent: email.textContent,
      htmlContent: email.htmlContent,
      replyTo: getReplyTo(env),
      tags: ["gloss-boss", email.type],
    }),
  });

  return {
    ok: response.ok,
    status: response.status,
    details: response.ok ? "" : await response.text().catch(() => ""),
  };
}

async function authorizeAdmin(request, env) {
  if (!env.FIREBASE_PROJECT_ID) {
    return { ok: false, status: 500, error: "FIREBASE_AUTH_NOT_CONFIGURED" };
  }

  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, status: 401, error: "AUTH_REQUIRED" };
  }

  const idToken = match[1].trim();
  const uid = readFirebaseUid(idToken);
  if (!uid) {
    return { ok: false, status: 401, error: "INVALID_AUTH_TOKEN" };
  }

  const projectId = encodeURIComponent(env.FIREBASE_PROJECT_ID);
  const adminUid = encodeURIComponent(uid);
  const adminDocumentUrl =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/admins/${adminUid}`;

  let response;
  try {
    response = await fetch(adminDocumentUrl, {
      headers: { authorization: `Bearer ${idToken}` },
    });
  } catch {
    return { ok: false, status: 503, error: "ADMIN_CHECK_FAILED" };
  }

  if (!response.ok) {
    return { ok: false, status: 403, error: "ADMIN_REQUIRED" };
  }

  return { ok: true, uid };
}

function readFirebaseUid(idToken) {
  try {
    const payloadPart = idToken.split(".")[1];
    if (!payloadPart) {
      return "";
    }

    const base64 = payloadPart.replaceAll("-", "+").replaceAll("_", "/");
    const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload = JSON.parse(atob(paddedBase64));
    const uid = String(payload.user_id || payload.sub || "").trim();
    const expiresAt = Number(payload.exp || 0) * 1000;

    if (!uid || !expiresAt || expiresAt <= Date.now()) {
      return "";
    }

    return uid;
  } catch {
    return "";
  }
}

function buildEmail(payload, env = {}) {
  const type = String(payload?.type || "").trim();
  const to = String(payload?.to || "").trim().toLowerCase();

  if (!to || !to.includes("@")) {
    return { ok: false, error: "VALID_TO_EMAIL_REQUIRED" };
  }

  if (type === "booking-confirmation") {
    return buildBookingEmail({
      type,
      to,
      confirmed: true,
      booking: payload.booking || {},
      env,
    });
  }

  if (type === "booking-cancellation") {
    return buildBookingEmail({
      type,
      to,
      confirmed: false,
      booking: payload.booking || {},
      env,
    });
  }

  if (type === "password-reset") {
    const resetLink = String(payload?.resetLink || "").trim();

    if (!resetLink.startsWith("https://")) {
      return { ok: false, error: "VALID_RESET_LINK_REQUIRED" };
    }

    return {
      ok: true,
      type,
      to,
      subject: "Reset your Gloss Boss password",
      textContent: [
        "You asked to reset your Gloss Boss password.",
        "",
        "Open this link to choose a new password:",
        resetLink,
        "",
        "If you did not request this, you can ignore this email.",
        "",
        "Gloss Boss Detailing",
      ].join("\n"),
      htmlContent: buildPasswordResetHtml(resetLink, env),
    };
  }

  return { ok: false, error: "UNKNOWN_EMAIL_TYPE" };
}

function buildBookingEmail({ type, to, confirmed, booking, env }) {
  const intro = confirmed
    ? "Your booking has been confirmed."
    : "Your booking has been cancelled. The appointment slot is now available again.";

  const subject = confirmed
    ? "Gloss Boss booking confirmed"
    : "Gloss Boss booking cancelled";

  const details = [
    ["Name", booking.customerName || booking.name || "-"],
    ["Service", booking.service || "-"],
    ["Date", booking.date || "-"],
    ["Time", booking.time || "-"],
    ["Vehicle", booking.vehicle || "-"],
  ];

  return {
    ok: true,
    type,
    to,
    subject,
    textContent: [
      intro,
      "",
      ...details.map(([label, value]) => `${label}: ${value}`),
      "",
      "Gloss Boss Detailing",
    ].join("\n"),
    htmlContent: buildBookingHtml({ intro, details, confirmed, env }),
  };
}

function buildBookingHtml({ intro, details, confirmed, env }) {
  const title = confirmed ? "Booking confirmed" : "Booking cancelled";
  const statusColor = confirmed ? "#22c55e" : "#ef4444";
  const statusBackground = confirmed ? "#ecfdf3" : "#fff1f2";

  const content = `
    <h1 style="margin:0 0 10px;color:#111827;font-size:25px;line-height:1.3;font-weight:800">
      ${escapeHtml(title)}
    </h1>
    <p style="margin:0 0 22px;color:#4b5563;font-size:16px;line-height:1.7">
      ${escapeHtml(intro)}
    </p>
    <div style="margin:0 0 22px;padding:12px 16px;border-left:4px solid ${statusColor};border-radius:8px;background:${statusBackground};color:#111827;font-size:14px;font-weight:700">
      Status: ${confirmed ? "Confirmed" : "Cancelled"}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px">
      ${details.map(([label, value], index) => `
        <tr>
          <td style="width:34%;padding:13px 14px;${index ? "border-top:1px solid #e5e7eb;" : ""}background:#f9fafb;color:#6b7280;font-size:14px">
            ${escapeHtml(label)}
          </td>
          <td style="padding:13px 14px;${index ? "border-top:1px solid #e5e7eb;" : ""}color:#111827;font-size:14px;font-weight:700">
            ${escapeHtml(value)}
          </td>
        </tr>
      `).join("")}
    </table>
    <p style="margin:22px 0 0;color:#6b7280;font-size:13px;line-height:1.7">
      If you have any questions about your appointment, simply reply to this email.
    </p>
  `;

  return buildEmailLayout({ preview: intro, content, env });
}

function buildPasswordResetHtml(resetLink, env) {
  const content = `
    <h1 style="margin:0 0 10px;color:#111827;font-size:25px;line-height:1.3;font-weight:800">
      Reset your password
    </h1>
    <p style="margin:0 0 24px;color:#4b5563;font-size:16px;line-height:1.7">
      We received a request to reset your Gloss Boss password. Use the button below to choose a new one.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td style="border-radius:9px;background:#0891b2">
          <a href="${escapeHtml(resetLink)}" style="display:inline-block;padding:13px 22px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">
            Reset password
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:24px 0 0;color:#6b7280;font-size:13px;line-height:1.7">
      If you did not request this, you can safely ignore this email.
    </p>
  `;

  return buildEmailLayout({
    preview: "Reset your Gloss Boss password",
    content,
    env,
  });
}

function buildEmailLayout({ preview, content, env }) {
  const logoUrl = getLogoUrl(env);

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Gloss Boss Detailing</title>
    </head>
    <body style="margin:0;padding:0;background:#eef2f6;font-family:Arial,Helvetica,sans-serif;color:#111827">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">
        ${escapeHtml(preview)}
      </div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#eef2f6">
        <tr>
          <td align="center" style="padding:28px 12px">
            <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;background:#ffffff;border:1px solid #dde3ea;border-radius:18px;overflow:hidden">
              <tr>
                <td align="center" style="padding:22px;background:#050b13">
                  <img src="${escapeHtml(logoUrl)}" width="96" alt="Gloss Boss Detailing" style="display:block;width:96px;max-width:96px;height:auto;border:0;border-radius:12px">
                  <div style="margin-top:10px;color:#ffffff;font-size:18px;font-weight:800;letter-spacing:.4px">
                    Gloss Boss Detailing
                  </div>
                  <div style="margin-top:4px;color:#8eddf0;font-size:12px;letter-spacing:1.6px;text-transform:uppercase">
                    Premium car care
                  </div>
                </td>
              </tr>
              <tr>
                <td style="padding:30px 28px">
                  ${content}
                </td>
              </tr>
              <tr>
                <td align="center" style="padding:18px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.6">
                  Gloss Boss Detailing<br>
                  This is an automated service message about your account or booking.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`;
}

function getLogoUrl(env) {
  const configuredUrl = String(env.EMAIL_LOGO_URL || "").trim();
  if (configuredUrl.startsWith("https://")) {
    return configuredUrl;
  }

  const appUrl = String(env.APP_URL || "").trim().replace(/\/+$/, "");
  return appUrl ? `${appUrl}/glos.jpeg` : "";
}

function getSender(env) {
  return {
    email: env.BREVO_SENDER_EMAIL,
    name: env.BREVO_SENDER_NAME || "Gloss Boss Detailing",
  };
}

function getReplyTo(env) {
  const email = isValidEmail(env.BREVO_REPLY_TO_EMAIL)
    ? env.BREVO_REPLY_TO_EMAIL
    : env.BREVO_SENDER_EMAIL;

  return {
    email,
    name: env.BREVO_REPLY_TO_NAME || env.BREVO_SENDER_NAME || "Gloss Boss Detailing",
  };
}

function isValidSenderEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  const domain = email.split("@")[1] || "";

  return isValidEmail(email)
    && !["example.com", "your-domain.com", "localhost"].includes(domain);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function buildCorsHeaders(request, env) {
  const requestOrigin = request.headers.get("Origin") || "";
  const allowedOrigins = new Set([
    env.APP_URL,
    "https://braazbedat10205-blip.github.io",
    "https://gloos-boos-site.firebaseapp.com",
    "https://gloos-boos-site.web.app",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
  ].filter(Boolean));

  const origin = allowedOrigins.has(requestOrigin) ? requestOrigin : env.APP_URL || "*";

  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  return new Set([
    env.APP_URL,
    "https://braazbedat10205-blip.github.io",
    "https://gloos-boos-site.firebaseapp.com",
    "https://gloos-boos-site.web.app",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
  ].filter(Boolean)).has(origin);
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
