import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 proxy (formerly middleware): fast redirect for protected pages when
 * no session cookie exists. Real authentication/authorization is enforced by
 * every API endpoint on the server.
 */
export function proxy(req: NextRequest) {
  if (!req.cookies.get("agrisense_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/login";
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/farms/:path*",
    "/predictions/:path*",
    "/monitoring/:path*",
    "/devices/:path*",
    "/weather/:path*",
    "/recommendations/:path*",
    "/notifications/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/admin/:path*",
  ],
};
