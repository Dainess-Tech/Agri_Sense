import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { farmMembers, farms, users } from "@/db/schema";
import { getFarmForUser } from "@/server/access";
import { publicUser, requireUser, type User } from "@/server/auth";
import { badRequest, forbidden, handle, json, notFound, parseBody } from "@/server/http";
import { UUID_RE } from "@/server/validators";
import { audit, logActivity } from "@/server/services/support";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ farmId: string }> };

const MEMBER_ROLES = ["viewer", "manager"] as const;
const memberRole = z.enum(MEMBER_ROLES);

/** Only the farm owner or a platform admin may change who can access a farm. */
async function requireMemberManager(user: User, farmId: string) {
  const farm = await getFarmForUser(user, farmId, "read");
  if (farm.ownerId !== user.id && user.role !== "admin") {
    throw forbidden("Only the farm owner or an administrator can manage farm members");
  }
  return farm;
}

/** GET /api/v1/farms/{id}/members — owner plus explicit memberships. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { farmId } = await ctx.params;
  const farm = await getFarmForUser(user, farmId, "read");
  const [owner] = await db.select().from(users).where(eq(users.id, farm.ownerId)).limit(1);
  const rows = await db
    .select({ member: farmMembers, user: users })
    .from(farmMembers)
    .innerJoin(users, eq(users.id, farmMembers.userId))
    .where(eq(farmMembers.farmId, farmId))
    .orderBy(asc(farmMembers.createdAt));
  return json({
    owner: owner ? publicUser(owner) : null,
    members: rows.map((r) => ({ ...r.member, user: publicUser(r.user) })),
  });
});

/** POST /api/v1/farms/{id}/members { email, role } — share a farm. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { farmId } = await ctx.params;
  const farm = await requireMemberManager(user, farmId);
  const body = await parseBody(req, z.object({ email: z.string().trim().toLowerCase().email(), role: memberRole.default("viewer") }));
  const [invitee] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
  if (!invitee) throw notFound("No AgriSense account found with that email address");
  if (invitee.id === farm.ownerId) throw badRequest("The farm owner already has full access");
  const [row] = await db
    .insert(farmMembers)
    .values({ farmId, userId: invitee.id, role: body.role })
    .onConflictDoUpdate({ target: [farmMembers.farmId, farmMembers.userId], set: { role: body.role } })
    .returning();
  await logActivity(farmId, user.id, "farm", `${invitee.fullName} granted ${body.role} access to ${farm.name}`);
  await audit(user.id, "farm.member_add", "farm", farmId, { userId: invitee.id, role: body.role });
  return json({ member: { ...row, user: publicUser(invitee) } }, 201);
});

/** PATCH /api/v1/farms/{id}/members { userId, role } — change an existing membership. */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { farmId } = await ctx.params;
  const farm = await requireMemberManager(user, farmId);
  const body = await parseBody(req, z.object({ userId: z.string().uuid(), role: memberRole }));
  if (body.userId === farm.ownerId) throw badRequest("The farm owner's access cannot be changed");
  const [row] = await db
    .update(farmMembers)
    .set({ role: body.role })
    .where(and(eq(farmMembers.farmId, farmId), eq(farmMembers.userId, body.userId)))
    .returning();
  if (!row) throw notFound("Farm member not found");
  await audit(user.id, "farm.member_role", "farm", farmId, { userId: body.userId, role: body.role });
  return json({ member: row });
});

/** DELETE /api/v1/farms/{id}/members?userId=… — revoke shared access. */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { farmId } = await ctx.params;
  const farm = await requireMemberManager(user, farmId);
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!UUID_RE.test(userId)) throw badRequest("A valid userId is required");
  if (userId === farm.ownerId) throw badRequest("The farm owner cannot be removed");
  const [row] = await db.delete(farmMembers).where(and(eq(farmMembers.farmId, farmId), eq(farmMembers.userId, userId))).returning();
  if (!row) throw notFound("Farm member not found");
  await logActivity(farmId, user.id, "farm", `Shared access revoked for a member of ${farm.name}`);
  await audit(user.id, "farm.member_remove", "farm", farmId, { userId });
  return json({ removed: true });
});
