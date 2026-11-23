import "server-only";
import * as webpush from "web-push";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { notificationPreferences, notifications, pushSubscriptions } from "@/db/schema";
import { severityRank, type Severity } from "@/modules/shared/units";

export type NotificationType = "risk" | "prediction" | "device" | "harvest" | "system";

let vapidReady: boolean | null = null;
export function pushConfigured(): boolean {
  if (vapidReady !== null) return vapidReady;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (pub && priv) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@agrisense.local", pub, priv);
    vapidReady = true;
  } else vapidReady = false;
  return vapidReady;
}

export async function getPreferences(userId: string) {
  const [p] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).limit(1);
  if (p) return p;
  const [created] = await db.insert(notificationPreferences).values({ userId }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)))[0];
}

const typePref = { risk: "riskAlerts", prediction: "predictionReady", device: "deviceOffline", harvest: "harvestReminders", system: "systemAnnouncements" } as const;

/**
 * Creates an in-app notification (always available fallback) and sends Web Push
 * when enabled. Respects preferences and suppresses repeats via dedupeKey to
 * avoid overwhelming farmers with repeated low-priority alerts.
 */
export async function notify(
  userId: string,
  n: { type: NotificationType; severity?: Severity; title: string; body: string; link?: string; farmId?: string | null; dedupeKey?: string; dedupeHours?: number },
) {
  const severity = n.severity ?? "info";
  const prefs = await getPreferences(userId);
  if (!prefs[typePref[n.type]]) return null;
  if (n.type === "risk" && severityRank(severity) < severityRank(prefs.minSeverity)) return null;
  if (n.dedupeKey) {
    const since = new Date(Date.now() - (n.dedupeHours ?? 24) * 3_600_000);
    const [dup] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.dedupeKey, n.dedupeKey), gt(notifications.createdAt, since)))
      .limit(1);
    if (dup) return null;
  }
  const [row] = await db
    .insert(notifications)
    .values({ userId, farmId: n.farmId ?? null, type: n.type, severity, title: n.title, body: n.body, link: n.link ?? null, dedupeKey: n.dedupeKey ?? null })
    .returning();
  if (prefs.pushEnabled && pushConfigured()) {
    const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    const payload = JSON.stringify({ title: n.title, body: n.body, url: n.link ?? "/notifications", tag: n.dedupeKey ?? row.id });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        }
      }),
    );
  }
  return row;
}
