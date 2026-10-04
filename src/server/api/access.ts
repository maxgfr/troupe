import { createHmac, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";

import { currentAccessCode } from "~/server/access-code";

export const ACCESS_COOKIE = "troupe-access";
export function accessCookieValue(code: string) { return createHmac("sha256", code).update("troupe-private-studio-v1").digest("hex"); }
export function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function firstValue(header: string | null) {
  return header?.split(",")[0]?.trim() || null;
}

export function hasAccess(headers: Headers) {
  const code = currentAccessCode();
  if (!code) return false;
  const cookie = headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${ACCESS_COOKIE}=`))?.slice(ACCESS_COOKIE.length + 1);
  return Boolean(cookie && sameSecret(cookie, accessCookieValue(code)));
}

// The host the browser addressed: behind a reverse proxy Host is often
// rewritten (e.g. "app:3000") while X-Forwarded-Host keeps the public name.
function addressedHosts(headers: Headers) {
  return [headers.get("host"), firstValue(headers.get("x-forwarded-host"))].filter((h): h is string => Boolean(h));
}

// The cookie is Secure when the browser reached us over HTTPS, including
// through a proxy that terminated TLS.
export function isHttpsRequest(req: Request) {
  return new URL(req.url).protocol === "https:" || firstValue(req.headers.get("x-forwarded-proto")) === "https" || Boolean(process.env.VERCEL);
}

export function assertRequestOrigin(headers: Headers) {
  const hosts = addressedHosts(headers);
  if (hosts.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "Missing request host." });
  const origin = headers.get("origin");
  if (origin) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new TRPCError({ code: "FORBIDDEN", message: "Invalid request origin." }); }
    if (!["http:", "https:"].includes(url.protocol) || !hosts.includes(url.host)) throw new TRPCError({ code: "FORBIDDEN", message: "Cross-origin requests are not allowed." });
  }
  if (headers.get("sec-fetch-site") === "cross-site") throw new TRPCError({ code: "FORBIDDEN", message: "Cross-site requests are not allowed." });
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function assertStudioRequest(headers: Headers) {
  assertRequestOrigin(headers);
  if (currentAccessCode()) {
    if (!hasAccess(headers)) throw new TRPCError({ code: "UNAUTHORIZED", message: "Enter your private studio access code." });
    return;
  }
  // Without a code (pnpm dev, tests) only the developer's own machine may in.
  // Production always has a code: configured, or generated on first start.
  if (process.env.NODE_ENV === "production" || !LOOPBACK.test(headers.get("host")!)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Set TROUPE_ACCESS_CODE to open the studio on this server." });
  }
}
