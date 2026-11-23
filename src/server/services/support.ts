import "server-only";
import { db } from "@/db";
import { auditLogs, farmActivities } from "@/db/schema";

/** Audit trail for important administrative / security operations. */
export async function audit(actorId: string | null, action: string, entity: string, entityId?: string | null, meta?: unknown) {
  try {
    await db.insert(auditLogs).values({ actorId, action, entity, entityId: entityId ?? null, meta: meta ?? null });
  } catch (e) {
    console.error("[audit] failed", e);
  }
}

export async function logActivity(farmId: string, userId: string | null, type: string, description: string, plantingId?: string | null) {
  await db.insert(farmActivities).values({ farmId, userId, type, description, plantingId: plantingId ?? null });
}

/**
 * Transactional email abstraction. In "console" mode (no provider configured)
 * messages are logged and the link is returned to the client so the demo works.
 * Plug a provider (Resend, SES, SMTP) here via MAIL_PROVIDER + credentials.
 */
export function mailConsoleMode() {
  return !process.env.MAIL_PROVIDER;
}

/**
 * Dev-only convenience links must never be exposed by a production deployment —
 * returning a password-reset token to the caller would allow account takeover.
 */
export function devLinksEnabled() {
  return process.env.NODE_ENV !== "production";
}

export async function sendMail(to: string, subject: string, text: string) {
  if (mailConsoleMode()) {
    console.log(`[mail:console] to=${to} subject="${subject}"\n${text}`);
    return { delivered: false };
  }

  const url = process.env.MAIL_API_URL;
  if (!url) {
    console.error(`[mail] MAIL_PROVIDER is set to "${process.env.MAIL_PROVIDER}" but MAIL_API_URL is missing; message to ${to} was not delivered.`);
    return { delivered: false };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.MAIL_API_KEY ? { Authorization: `Bearer ${process.env.MAIL_API_KEY}` } : {}),
      },
      body: JSON.stringify({ to, subject, text }),
    });
    if (!res.ok) {
      console.error(`[mail] provider returned ${res.status} for ${to}`);
      return { delivered: false };
    }
    return { delivered: true };
  } catch (e) {
    console.error(`[mail] delivery to ${to} failed`, e);
    return { delivered: false };
  }
}

export function appUrl(req: Request) {
  return process.env.APP_URL || new URL(req.url).origin;
}
