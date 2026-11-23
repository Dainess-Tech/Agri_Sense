import "server-only";
import { and, eq, isNull, or, inArray } from "drizzle-orm";
import { db } from "@/db";
import { farmMembers, farms, iotDevices } from "@/db/schema";
import type { User } from "./auth";
import { forbidden, notFound } from "./http";

export type Farm = typeof farms.$inferSelect;

/**
 * Ownership check enforced on every private farm endpoint.
 * read: owner, farm members, admins, agronomists (advisory read access)
 * write: owner, members with "manager" role, admins
 */
export async function getFarmForUser(user: User, farmId: string, mode: "read" | "write" = "read"): Promise<Farm> {
  if (!/^[0-9a-f-]{36}$/i.test(farmId)) throw notFound("Farm not found");
  const [farm] = await db.select().from(farms).where(eq(farms.id, farmId)).limit(1);
  if (!farm) throw notFound("Farm not found");
  if (farm.ownerId === user.id || user.role === "admin") return farm;
  const [member] = await db
    .select()
    .from(farmMembers)
    .where(and(eq(farmMembers.farmId, farmId), eq(farmMembers.userId, user.id)))
    .limit(1);
  if (mode === "read" && (member || user.role === "agronomist")) return farm;
  if (mode === "write" && member?.role === "manager") return farm;
  throw forbidden("You do not have access to this farm");
}

/** True when the user is allowed to mutate the given farm (same rule as getFarmForUser(..., "write")). */
export async function canEditFarm(user: User, farmId: string): Promise<boolean> {
  if (user.role === "admin") return true;
  const [farm] = await db.select({ ownerId: farms.ownerId }).from(farms).where(eq(farms.id, farmId)).limit(1);
  if (!farm) return false;
  if (farm.ownerId === user.id) return true;
  const [member] = await db
    .select({ role: farmMembers.role })
    .from(farmMembers)
    .where(and(eq(farmMembers.farmId, farmId), eq(farmMembers.userId, user.id)))
    .limit(1);
  return member?.role === "manager";
}

/** Loads a device and enforces access through its farm. */
export async function getDeviceForUser(user: User, deviceId: string, mode: "read" | "write" = "read") {
  if (!/^[0-9a-f-]{36}$/i.test(deviceId)) throw notFound("Device not found");
  const [device] = await db.select().from(iotDevices).where(eq(iotDevices.id, deviceId)).limit(1);
  if (!device) throw notFound("Device not found");
  const farm = await getFarmForUser(user, device.farmId, mode);
  return { device, farm };
}

/** Farm ids the user can see on their own dashboard (owned + shared, non-archived). */
export async function accessibleFarms(user: User, includeArchived = false): Promise<Farm[]> {
  const memberRows = await db.select({ farmId: farmMembers.farmId }).from(farmMembers).where(eq(farmMembers.userId, user.id));
  const shared = memberRows.map((r) => r.farmId);
  const ownership = shared.length ? or(eq(farms.ownerId, user.id), inArray(farms.id, shared)) : eq(farms.ownerId, user.id);
  return db
    .select()
    .from(farms)
    .where(includeArchived ? ownership : and(ownership, isNull(farms.archivedAt)))
    .orderBy(farms.createdAt);
}
