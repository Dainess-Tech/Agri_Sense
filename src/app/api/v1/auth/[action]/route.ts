import { and, count, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { authTokens, sessions, users } from "@/db/schema";
import { createSession, destroySession, getCurrentUser, hashPassword, publicUser, randomToken, requireUser, sha256, verifyPassword } from "@/server/auth";
import { ApiError, badRequest, clientIp, handle, json, notFound, parseBody, rateLimit, unauthorized } from "@/server/http";
import { getPreferences } from "@/server/services/notifications";
import { ensureSeed } from "@/server/services/seed";
import { appUrl, audit, devLinksEnabled, mailConsoleMode, sendMail } from "@/server/services/support";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ action: string }> };

const password = z.string().min(8, "Password must be at least 8 characters").max(128);
const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(255);

async function issueToken(userId: string, type: "verify_email" | "reset_password", ttlMs: number) {
  const token = randomToken();
  await db.insert(authTokens).values({ userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

async function consumeToken(token: string, type: "verify_email" | "reset_password") {
  const [row] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.type, type), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .limit(1);
  if (!row) throw badRequest("This link is invalid or has expired.");
  await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
  return row;
}

async function sendVerification(req: Request, userId: string, to: string) {
  const token = await issueToken(userId, "verify_email", 24 * 3_600_000);
  const link = `${appUrl(req)}/auth/verify?token=${token}`;
  await sendMail(to, "Verify your AgriSense email", `Welcome to AgriSense! Verify your email: ${link}`);
  return devLinksEnabled() && mailConsoleMode() ? link : undefined;
}

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { action } = await ctx.params;
  if (action !== "me") throw notFound();
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  return json({ user: publicUser(user) });
});

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { action } = await ctx.params;
  const ip = clientIp(req);

  switch (action) {
    case "register": {
      rateLimit(`register:${ip}`, 10, 15 * 60_000);
      const body = await parseBody(req, z.object({ fullName: z.string().trim().min(2).max(120), email, password, country: z.string().trim().max(64).optional() }));
      await ensureSeed();
      const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
      if (exists) throw new ApiError(409, "An account with this email already exists.", undefined, "conflict");
      const [{ value: total }] = await db.select({ value: count() }).from(users);
      const [user] = await db
        .insert(users)
        .values({ fullName: body.fullName, email: body.email, passwordHash: await hashPassword(body.password), country: body.country || null, role: total === 0 ? "admin" : "farmer" })
        .returning();
      await getPreferences(user.id);
      const devVerificationLink = await sendVerification(req, user.id, user.email);
      await createSession(user.id, req.headers.get("user-agent"));
      await audit(user.id, "user.register", "user", user.id, { firstUserAdmin: total === 0 });
      return json({ user: publicUser(user), devVerificationLink }, 201);
    }
    case "login": {
      const body = await parseBody(req, z.object({ email, password: z.string().min(1).max(128) }));
      rateLimit(`login:${ip}`, 20, 15 * 60_000);
      rateLimit(`login:${body.email}`, 8, 15 * 60_000);
      const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
      if (!user || !(await verifyPassword(body.password, user.passwordHash))) throw unauthorized("Incorrect email or password.");
      await createSession(user.id, req.headers.get("user-agent"));
      return json({ user: publicUser(user) });
    }
    case "logout": {
      await destroySession();
      return json(null, 204);
    }
    case "forgot-password": {
      rateLimit(`forgot:${ip}`, 5, 15 * 60_000);
      const body = await parseBody(req, z.object({ email }));
      const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
      let devResetLink: string | undefined;
      if (user) {
        const token = await issueToken(user.id, "reset_password", 3_600_000);
        const link = `${appUrl(req)}/auth/reset?token=${token}`;
        await sendMail(user.email, "Reset your AgriSense password", `Reset your password (valid 1 hour): ${link}`);
        if (devLinksEnabled() && mailConsoleMode()) devResetLink = link;
      }
      // Same response whether or not the account exists (prevents account enumeration).
      // devResetLink is only ever present in local development console mode.
      return json({ message: "If an account exists for that email, a reset link has been sent.", ...(devResetLink ? { devResetLink } : {}) });
    }
    case "reset-password": {
      rateLimit(`reset:${ip}`, 10, 15 * 60_000);
      const body = await parseBody(req, z.object({ token: z.string().min(10), password }));
      const t = await consumeToken(body.token, "reset_password");
      await db.update(users).set({ passwordHash: await hashPassword(body.password), updatedAt: new Date() }).where(eq(users.id, t.userId));
      await db.delete(sessions).where(eq(sessions.userId, t.userId)); // revoke all sessions
      await audit(t.userId, "user.password_reset", "user", t.userId);
      return json({ message: "Password updated. Please sign in." });
    }
    case "verify-email": {
      const body = await parseBody(req, z.object({ token: z.string().min(10) }));
      const t = await consumeToken(body.token, "verify_email");
      await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, t.userId));
      return json({ message: "Email verified." });
    }
    case "resend-verification": {
      const user = await requireUser();
      rateLimit(`resend:${user.id}`, 3, 15 * 60_000);
      if (user.emailVerifiedAt) return json({ message: "Email already verified." });
      const devVerificationLink = await sendVerification(req, user.id, user.email);
      return json({ message: "Verification email sent.", devVerificationLink });
    }
    default:
      throw notFound();
  }
});
