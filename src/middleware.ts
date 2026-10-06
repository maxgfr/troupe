import { NextResponse, type NextRequest } from "next/server";

import { accessCookieValue, sameSecret } from "~/server/api/access";
import { currentAccessCode } from "~/server/access-code";

// Pages require the access cookie; API routes check it themselves.
// Without a code only `pnpm dev` lets pages through (the API still limits
// those requests to loopback).
export function middleware(req: NextRequest) {
  const code = currentAccessCode();
  if (!code)
    return process.env.NODE_ENV === "production"
      ? NextResponse.redirect(new URL("/access", req.url))
      : NextResponse.next();
  const cookie = req.cookies.get("troupe-access")?.value;
  if (cookie && sameSecret(cookie, accessCookieValue(code))) return NextResponse.next();
  return NextResponse.redirect(new URL("/access", req.url));
}

export const config = {
  // Node.js runtime: the code may come from the data directory.
  runtime: "nodejs",
  matcher: ["/((?!api|access|_next|favicon.ico).*)"],
};
