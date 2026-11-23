import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { recommendations } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { getFarmForUser } from "@/server/access";
import { handle, json, notFound, parseBody } from "@/server/http";
import { logActivity } from "@/server/services/support";
import { UUID_RE } from "@/server/validators";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ recommendationId: string }> };

/** PATCH /api/v1/recommendations/{id} { status: "read" | "completed" | "new" } — offline-queue safe (idempotent). */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const id = (await ctx.params).recommendationId;
  if (!UUID_RE.test(id)) throw notFound();
  const user = await requireUser();
  const body = await parseBody(req, z.object({ status: z.enum(["new", "read", "completed"]) }));
  const [rec] = await db.select().from(recommendations).where(eq(recommendations.id, id)).limit(1);
  if (!rec) throw notFound("Recommendation not found");
  await getFarmForUser(user, rec.farmId, "write");
  const [updated] = await db.update(recommendations).set({ status: body.status, updatedAt: new Date() }).where(eq(recommendations.id, id)).returning();
  if (body.status === "completed" && rec.status !== "completed") await logActivity(rec.farmId, user.id, "recommendation", `Completed: ${rec.title}`, rec.plantingId);
  return json({ recommendation: updated });
});
