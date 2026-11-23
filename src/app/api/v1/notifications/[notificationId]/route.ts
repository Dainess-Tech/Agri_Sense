import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { notifications, pushSubscriptions } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { forbidden, handle, json, notFound, parseBody } from "@/server/http";
import { pushConfigured } from "@/server/services/notifications";
import { UUID_RE } from "@/server/validators";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ notificationId: string }> };

/** GET /api/v1/notifications/push — Web Push availability + VAPID public key. */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  await requireUser();
  if ((await ctx.params).notificationId !== "push") throw notFound();
  return json({ configured: pushConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY ?? null });
});

/** POST /api/v1/notifications/push — store a browser push subscription. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  if ((await ctx.params).notificationId !== "push") throw notFound();
  const user = await requireUser();
  const body = await parseBody(req, z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }));
  const [existing] = await db.select({ userId: pushSubscriptions.userId }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, body.endpoint)).limit(1);
  if (existing && existing.userId !== user.id) throw forbidden("This push subscription belongs to another account.");
  await db
    .insert(pushSubscriptions)
    .values({ userId: user.id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh: body.keys.p256dh, auth: body.keys.auth } });
  return json({ ok: true }, 201);
});

/** PATCH /api/v1/notifications/{id} { read: true } — mark one notification read/unread. */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const id = (await ctx.params).notificationId;
  if (!UUID_RE.test(id)) throw notFound();
  const body = await parseBody(req, z.object({ read: z.boolean().default(true) }));
  const [n] = await db
    .update(notifications)
    .set({ readAt: body.read ? new Date() : null })
    .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)))
    .returning();
  if (!n) throw notFound();
  return json({ notification: n });
});
