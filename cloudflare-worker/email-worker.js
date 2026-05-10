const BREVO_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";

export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, corsHeaders);
    }

    if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
      return json({ ok: false, error: "BREVO_NOT_CONFIGURED" }, 500, corsHeaders);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: "INVALID_JSON" }, 400, corsHeaders);
    }

    const email = buildEmail(payload, env);
    if (!email.ok) {
      return json(email, 400, corsHeaders);
    }

    const brevoResponse = await fetch(BREVO_EMAIL_URL, {
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
        replyTo: getSender(env),
        tags: ["gloss-boss", email.type],
      }),
    });

    if (!brevoResponse.ok) {
      const details = await brevoResponse.text().catch(() => "");
      return json(
        {
          ok: false,
          error: "BREVO_SEND_FAILED",
          status: brevoResponse.status,
          details,
        },
        502,
        corsHeaders,
      );
    }

    return json({ ok: true, type: email.type }, 200, corsHeaders);
  },
};

function buildEmail(payload, env) {
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
    });
  }

  if (type === "booking-cancellation") {
    return buildBookingEmail({
      type,
      to,
      confirmed: false,
      booking: payload.booking || {},
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

function buildBookingEmail({ type, to, confirmed, booking }) {
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
    htmlContent: buildBookingHtml({ intro, details, confirmed }),
  };
}

function buildBookingHtml({ intro, details, confirmed }) {
  const statusColor = confirmed ? "#1a7f37" : "#b42318";

  return `
    <div style="margin:0;padding:24px;background:#f5f7fb;font-family:Arial,sans-serif;color:#111827">
      <div style="max-width:560px;margin:auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
        <div style="padding:20px 22px;background:#0a1320;color:#ffffff">
          <strong style="font-size:18px">Gloss Boss Detailing</strong>
        </div>
        <div style="padding:22px">
          <p style="margin:0 0 14px;font-size:16px;color:${statusColor};font-weight:700">${escapeHtml(intro)}</p>
          <table style="width:100%;border-collapse:collapse">
            ${details.map(([label, value]) => `
              <tr>
                <td style="padding:10px;border-bottom:1px solid #eef0f4;color:#6b7280">${escapeHtml(label)}</td>
                <td style="padding:10px;border-bottom:1px solid #eef0f4;font-weight:700">${escapeHtml(value)}</td>
              </tr>
            `).join("")}
          </table>
        </div>
      </div>
    </div>
  `;
}

function buildPasswordResetHtml(resetLink) {
  return `
    <div style="margin:0;padding:24px;background:#f5f7fb;font-family:Arial,sans-serif;color:#111827">
      <div style="max-width:560px;margin:auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
        <div style="padding:20px 22px;background:#0a1320;color:#ffffff">
          <strong style="font-size:18px">Gloss Boss Detailing</strong>
        </div>
        <div style="padding:22px">
          <h2 style="margin:0 0 12px;font-size:20px">Reset your password</h2>
          <p style="margin:0 0 18px;line-height:1.6">You asked to reset your Gloss Boss password. Use the button below to choose a new password.</p>
          <a href="${escapeHtml(resetLink)}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#0a1320;color:#ffffff;text-decoration:none;font-weight:700">Reset password</a>
          <p style="margin:18px 0 0;color:#6b7280;font-size:13px;line-height:1.6">If you did not request this, you can ignore this email.</p>
        </div>
      </div>
    </div>
  `;
}

function getSender(env) {
  return {
    email: env.BREVO_SENDER_EMAIL,
    name: env.BREVO_SENDER_NAME || "Gloss Boss Detailing",
  };
}

function buildCorsHeaders(request, env) {
  const requestOrigin = request.headers.get("Origin") || "";
  const allowedOrigins = new Set([
    env.APP_URL,
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
