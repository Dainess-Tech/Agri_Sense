import { ZodError, type ZodType } from "zod";

/** Typed API error mapped to consistent JSON + status codes (SRS §9). */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    public code?: string,
  ) {
    super(message);
  }
}

export const badRequest = (m: string, d?: unknown) => new ApiError(400, m, d, "bad_request");
export const unauthorized = (m = "Authentication required") => new ApiError(401, m, undefined, "unauthorized");
export const forbidden = (m = "You do not have permission to access this resource") => new ApiError(403, m, undefined, "forbidden");
export const notFound = (m = "Resource not found") => new ApiError(404, m, undefined, "not_found");
export const conflict = (m: string, d?: unknown) => new ApiError(409, m, d, "conflict");

export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  if (status === 204) return new Response(null, { status });
  return Response.json(data, { status, headers });
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler with uniform error handling and logging. */
export function handle<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ error: { code: err.code ?? "error", message: err.message, details: err.details } }, err.status);
      }
      if (err instanceof ZodError) {
        return json({ error: { code: "validation_failed", message: "Validation failed", details: err.issues } }, 422);
      }
      console.error(`[api] ${req.method} ${new URL(req.url).pathname} failed:`, err);
      return json({ error: { code: "internal_error", message: "Unexpected server error" } }, 500);
    }
  };
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new ApiError(422, "Validation failed", result.error.issues, "validation_failed");
  return result.data;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

// Simple in-memory fixed-window rate limiter (single instance; swap for Redis when scaling).
const buckets = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    return;
  }
  b.count++;
  if (b.count > limit) {
    throw new ApiError(429, `Too many requests. Try again in ${Math.ceil((b.resetAt - now) / 1000)}s.`, undefined, "rate_limited");
  }
}

export function pageParams(url: URL, defLimit = 50, maxLimit = 500) {
  const limit = Math.min(maxLimit, Math.max(1, Number(url.searchParams.get("limit")) || defLimit));
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  return { limit, page, offset: (page - 1) * limit };
}
