import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { handle, json, pageParams } from "@/server/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/notifications?unread=1&page=1 — in-app notification centre. */
export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const { limit, offset, page } = pageParams(url, 30, 100);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const where = unreadOnly ? and(eq(notifications.userId, user.id), isNull(notifications.readAt)) : eq(notifications.userId, user.id);
  const [rows, [{ unread }]] = await Promise.all([
    db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(limit).offset(offset),
    db.select({ unread: count() }).from(notifications).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
  ]);
  return json({ notifications: rows, unread, page, limit });
});

/** POST /api/v1/notifications — marks all as read. */
export const POST = handle(async () => {
  const user = await requireUser();
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  return json(null, 204);
});
