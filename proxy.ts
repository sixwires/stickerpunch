import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Admin route gate. Accepts either:
 *  - Authorization: Bearer <ADMIN_TOKEN>, or
 *  - ?token=<ADMIN_TOKEN> on the URL.
 *
 * No token configured -> 403, even in dev, so the route is never accidentally
 * exposed.
 */
export function proxy(request: NextRequest): NextResponse {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    return new NextResponse("Admin disabled", { status: 403 });
  }
  const auth = request.headers.get("authorization");
  const bearer = auth?.match(/^Bearer (.+)$/i)?.[1];
  const query = request.nextUrl.searchParams.get("token");
  if (bearer === token || query === token) {
    return NextResponse.next();
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export const config = {
  matcher: ["/admin/:path*"],
};
