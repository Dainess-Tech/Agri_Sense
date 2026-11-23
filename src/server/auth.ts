import "server-only";
import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { forbidden, unauthorized } from "./http";

export const SESSION_COOKIE = "agrisense_session";
const SESSION_DAYS = 30;
const REFRESH_WHEN_DAYS_LEFT = 15;

export type User = typeof users.$inferSelect;
export type Role = User["role"];

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 11);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

async function isHttps() {
  if (process.env.INSECURE_COOKIES === "1") return false;
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim();
  return proto === "https";
}

async function setCookie(token: string, expires: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await isHttps(),
    path: "/",
    expires,
  });
}

export async function createSession(userId: string, userAgent?: string | null) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ userId, tokenHash: sha256(token), expiresAt, userAgent: userAgent?.slice(0, 255) });
  await setCookie(token, expiresAt);
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

/** Returns the authenticated user or null. Implements sliding session refresh. */
export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!rows[0]) return null;
  const { user, session } = rows[0];
  if (session.expiresAt.getTime() - Date.now() < REFRESH_WHEN_DAYS_LEFT * 86_400_000) {
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, session.id));
    try {
      await setCookie(token, expiresAt);
    } catch {
      /* cookies are read-only in some render contexts */
    }
  }
  return user;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  return user;
}

export function requireRole(user: User, roles: Role[]) {
  if (!roles.includes(user.role)) throw forbidden();
}

export function publicUser(u: User) {
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    role: u.role,
    phone: u.phone,
    country: u.country,
    language: u.language,
    measurementSystem: u.measurementSystem,
    emailVerified: !!u.emailVerifiedAt,
    createdAt: u.createdAt,
  };
}
