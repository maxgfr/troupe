import { NextResponse } from "next/server";
import { ACCESS_COOKIE, accessCookieValue, assertRequestOrigin, isHttpsRequest, sameSecret } from "~/server/api/access";
import { clearFailures, clientAddress, recordFailure, retryAfterS } from "~/server/api/attempts";
import { currentAccessCode } from "~/server/access-code";

export async function POST(req: Request) {
  try { assertRequestOrigin(req.headers); } catch { return Response.json({ error: "Invalid origin." }, { status: 403 }); }
  const expected = currentAccessCode();
  if (!expected) return Response.json({ error: "Set TROUPE_ACCESS_CODE on the server to open the studio." }, { status: 503 });
  const address = clientAddress(req.headers);
  const wait = retryAfterS(address);
  if (wait > 0) {
    return Response.json({ error: `Too many wrong codes. Try again in ${Math.ceil(wait / 60)} minutes.` }, { status: 429, headers: { "retry-after": String(wait) } });
  }
  try {
    if (Number(req.headers.get("content-length") ?? 0) > 2048) return new Response(null, { status: 413 });
    const text = await req.text();
    if (text.length > 2048) return new Response(null, { status: 413 });
    const input = JSON.parse(text) as { code?: unknown };
    if (typeof input.code !== "string" || !sameSecret(input.code, expected)) {
      recordFailure(address);
      return Response.json({ error: "This access code is incorrect." }, { status: 401 });
    }
    clearFailures(address);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(ACCESS_COOKIE, accessCookieValue(expected), { httpOnly: true, secure: isHttpsRequest(req), sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
    return response;
  } catch { return Response.json({ error: "Could not open the studio." }, { status: 400 }); }
}
