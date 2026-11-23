import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { farmActivities, farms, iotDevices, notificationPreferences, plantings, predictions, recommendations, sessions, users } from "@/db/schema";
import { destroySession, hashPassword, publicUser, requireUser, verifyPassword } from "@/server/auth";
import { badRequest, handle, json, notFound, parseBody } from "@/server/http";
import { getPreferences } from "@/server/services/notifications";
import { audit } from "@/server/services/support";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ section: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { section } = await ctx.params;
  const user = await requireUser();
  if (section === "profile") return json({ user: publicUser(user) });
  if (section === "preferences") return json({ preferences: await getPreferences(user.id) });
  if (section === "export") {
    // GDPR-style personal data export
    const myFarms = await db.select().from(farms).where(eq(farms.ownerId, user.id));
    const ids = myFarms.map((f) => f.id);
    const data = {
      exportedAt: new Date().toISOString(),
      profile: publicUser(user),
      preferences: await getPreferences(user.id),
      farms: myFarms,
      plantings: ids.length ? await db.select().from(plantings).where(inArray(plantings.farmId, ids)) : [],
      devices: ids.length ? (await db.select().from(iotDevices).where(inArray(iotDevices.farmId, ids))).map(({ apiKeyHash: _k, ...d }) => d) : [],
      predictions: ids.length ? await db.select().from(predictions).where(inArray(predictions.farmId, ids)) : [],
      recommendations: ids.length ? await db.select().from(recommendations).where(inArray(recommendations.farmId, ids)) : [],
      activities: ids.length ? await db.select().from(farmActivities).where(inArray(farmActivities.farmId, ids)) : [],
    };
    return new Response(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="agrisense-data-export.json"` },
    });
  }
  throw notFound();
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const { section } = await ctx.params;
  const user = await requireUser();
  if (section === "profile") {
    const body = await parseBody(
      req,
      z.object({
        fullName: z.string().trim().min(2).max(120).optional(),
        phone: z.string().trim().max(32).nullable().optional(),
        country: z.string().trim().max(64).nullable().optional(),
        language: z.enum(["en", "sw", "fr", "pl"]).optional(),
        measurementSystem: z.enum(["metric", "imperial"]).optional(),
      }),
    );
    const [u] = await db.update(users).set({ ...body, updatedAt: new Date() }).where(eq(users.id, user.id)).returning();
    return json({ user: publicUser(u) });
  }
  if (section === "preferences") {
    const body = await parseBody(
      req,
      z.object({
        riskAlerts: z.boolean().optional(),
        predictionReady: z.boolean().optional(),
        deviceOffline: z.boolean().optional(),
        harvestReminders: z.boolean().optional(),
        systemAnnouncements: z.boolean().optional(),
        pushEnabled: z.boolean().optional(),
        minSeverity: z.enum(["info", "low", "medium", "high", "critical"]).optional(),
      }),
    );
    await getPreferences(user.id);
    const [p] = await db.update(notificationPreferences).set({ ...body, updatedAt: new Date() }).where(eq(notificationPreferences.userId, user.id)).returning();
    return json({ preferences: p });
  }
  if (section === "password") {
    const body = await parseBody(req, z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(128) }));
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) throw badRequest("Current password is incorrect.");
    await db.update(users).set({ passwordHash: await hashPassword(body.newPassword), updatedAt: new Date() }).where(eq(users.id, user.id));
    // Changing a password must invalidate existing sessions, including the current one.
    await db.delete(sessions).where(eq(sessions.userId, user.id));
    await destroySession();
    await audit(user.id, "user.password_change", "user", user.id);
    return json({ message: "Password changed. Please sign in again." });
  }
  throw notFound();
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const { section } = await ctx.params;
  if (section !== "profile") throw notFound();
  const user = await requireUser();
  const body = await parseBody(req, z.object({ password: z.string().min(1) }));
  if (!(await verifyPassword(body.password, user.passwordHash))) throw badRequest("Password is incorrect.");
  await audit(user.id, "user.delete", "user", user.id, { email: user.email });
  await destroySession();
  await db.delete(users).where(eq(users.id, user.id)); // cascades to farms, plantings, devices, readings…
  return json(null, 204);
});
