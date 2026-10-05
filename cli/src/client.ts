import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import superjson from "superjson";

// Type-only: the CLI is checked against the server's router, and none of the
// server's code ends up in the CLI bundle.
import type { AppRouter } from "../../src/server/api/root.ts";
import { CliError, EXIT } from "./errors.ts";

export type Api = ReturnType<typeof createApi>;
export type Outputs = inferRouterOutputs<AppRouter>;
export type Inputs = inferRouterInputs<AppRouter>;

// The cookie the studio sets once the access code is right
// (ACCESS_COOKIE in src/server/api/access.ts).
export const ACCESS_COOKIE = "troupe-access";
export const USER_AGENT = "troupe-cli/0.1.0";

export interface Connection {
  url: string;
  // Resolved on the first request: TROUPE_ACCESS_CODE is exchanged then.
  cookie: () => Promise<string | null>;
}

async function authHeaders(connection: Connection): Promise<Record<string, string>> {
  const cookie = await connection.cookie();
  return { "user-agent": USER_AGENT, ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}) };
}

// The same tRPC API the studio's pages use, over plain HTTP. One request per
// call (no batching): errors stay attached to the call that caused them.
export function createApi(connection: Connection) {
  return createTRPCClient<AppRouter>({
    links: [httpLink({ url: `${connection.url}/api/trpc`, transformer: superjson, headers: () => authHeaders(connection) })],
  });
}

// POST /api/access, as the access page does: the code for the cookie.
// Returns null when the studio has no access code (pnpm dev on loopback).
export async function exchangeAccessCode(url: string, code: string): Promise<string | null> {
  const response = await fetch(`${url}/api/access`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": USER_AGENT },
    body: JSON.stringify({ code }),
    redirect: "manual",
  });
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const said = typeof body?.error === "string" ? body.error : null;
  if (response.status === 503) return null;
  if (!response.ok) {
    const auth = response.status === 401 || response.status === 429;
    throw new CliError(said ?? `The studio at ${url} refused the access code (HTTP ${response.status}).`, { exitCode: auth ? EXIT.auth : EXIT.failed, code: auth ? "UNAUTHORIZED" : "ACCESS_FAILED" });
  }
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const at = pair?.indexOf("=") ?? -1;
    if (pair && at > 0 && pair.slice(0, at).trim() === ACCESS_COOKIE) return pair.slice(at + 1).trim();
  }
  throw new CliError(`The studio at ${url} accepted the code but set no ${ACCESS_COOKIE} cookie. Is this a Troupe studio?`, { code: "BAD_RESPONSE" });
}

// GET /api/health: the server and its database answer. No sign-in needed.
export async function studioHealth(url: string): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(`${url}/api/health`, { headers: { "user-agent": USER_AGENT }, redirect: "manual" });
  const body = (await response.json().catch(() => null)) as { ok?: unknown } | null;
  return { ok: response.ok && body?.ok === true, status: response.status };
}

// A stored video (/api/media/<id>). The access cookie is sent to the studio
// only: a redirect to another origin (Supabase Storage) is followed without it.
export async function fetchMedia(connection: Connection, path: string): Promise<Response> {
  let target = new URL(path, `${connection.url}/`);
  const studio = new URL(connection.url).origin;
  for (let hops = 0; hops < 5; hops++) {
    const headers = target.origin === studio ? await authHeaders(connection) : { "user-agent": USER_AGENT };
    const response = await fetch(target, { headers, redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      target = new URL(location, target);
      continue;
    }
    return response;
  }
  throw new CliError(`Too many redirects while downloading ${path}.`);
}

const NETWORK_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);

// fetch() fails with TypeError("fetch failed") and the reason in `cause`.
function networkReason(error: unknown): string | null {
  let failedFetch = false;
  let detail = "";
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && NETWORK_CODES.has(code)) return code;
    if (e instanceof TypeError && e.message === "fetch failed") failedFetch = true;
    else if (failedFetch && e instanceof Error) detail = e.message;
  }
  return failedFetch ? `fetch failed${detail ? `: ${detail}` : ""}` : null;
}

interface ErrorData {
  code?: string;
  httpStatus?: number;
  zodError?: { formErrors: string[]; fieldErrors: Record<string, string[] | undefined> } | null;
}

// Any failure as a CliError: what the studio said, or why it could not be asked.
export function explainError(error: unknown, url: string): CliError {
  if (error instanceof CliError) return error;
  const reason = networkReason(error);
  if (reason) {
    return new CliError(`Cannot reach the studio at ${url} (${reason}). Is it running? Check the address with troupe whoami.`, { exitCode: EXIT.unreachable, code: "UNREACHABLE" });
  }
  if (error instanceof TRPCClientError) {
    const data = error.data as ErrorData | undefined;
    if (!data?.code) {
      return new CliError(`The studio at ${url} sent an answer the CLI cannot read (${error.message}). Is this the address of a Troupe studio?`, { code: "BAD_RESPONSE" });
    }
    if (data.code === "UNAUTHORIZED" || data.code === "FORBIDDEN") {
      return new CliError(`${error.message} Run troupe login.`, { exitCode: EXIT.auth, code: data.code });
    }
    if (data.zodError) {
      const fields = Object.entries(data.zodError.fieldErrors).map(([field, problems]) => `${field}: ${(problems ?? []).join(", ")}`);
      return new CliError(`The studio refused the request: ${[...data.zodError.formErrors, ...fields].join("; ")}`, { exitCode: EXIT.usage, code: "BAD_REQUEST" });
    }
    return new CliError(error.message, { code: data.code });
  }
  return new CliError(error instanceof Error ? error.message : String(error));
}
