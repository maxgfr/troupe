import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type ClientRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

// Links the library fetches for the user (an article, a video file) must
// point at the public internet: never at this server, its containers, the
// LAN or a cloud metadata endpoint. checkLocalUrl (src/server/settings/urls.ts)
// is the opposite rule, for model servers the user runs nearby.
//
// The address is checked as written AND every address the name resolves to
// is checked when the connection opens (a custom DNS lookup), so a name that
// resolves to a private address, or changes its answer between two lookups,
// is refused too. Redirects are followed by hand, each hop checked again.

const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata.goog", "metadata", "instance-data", "instance-data.ec2.internal"]);
const PORTS = new Set(["", "80", "443", "8080", "8443"]);

function v4(ip: string): number[] {
  return ip.split(".").map(Number);
}

function v4Problem(ip: string, allowPrivate: boolean): string | null {
  const [a, b, c] = v4(ip) as [number, number, number, number];
  if (a === 169 && b === 254) return "a link-local address (169.254.x.x)";
  if (a === 0) return "an unreachable address (0.x.x.x)";
  if (a >= 224) return "a multicast or reserved address";
  if (allowPrivate) return null;
  if (a === 127) return "this server itself";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "a private network address";
  if (a === 100 && b >= 64 && b <= 127) return "a shared network address (100.64.0.0/10)";
  if (a === 198 && (b === 18 || b === 19)) return "a benchmarking network address";
  if ((a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return "a reserved address";
  return null;
}

// The eight 16-bit groups of an IPv6 address (with an IPv4 tail turned into
// two groups).
function v6Groups(ip: string): number[] | null {
  let address = ip.toLowerCase().replace(/%.*$/, "");
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (tail) {
    const [a, b, c, d] = v4(tail[1]!);
    address = `${address.slice(0, -tail[1]!.length)}${((a! << 8) | b!).toString(16)}:${((c! << 8) | d!).toString(16)}`;
  }
  const [head, rest] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const fill = address.includes("::") ? 8 - left.length - right.length : 0;
  const groups = [...left, ...Array(fill).fill("0"), ...right].map((g) => Number.parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

// Why an IP address may not be fetched, or null when it may.
export function checkPublicAddress(ip: string, { allowPrivate = false }: { allowPrivate?: boolean } = {}): string | null {
  const family = isIP(ip);
  if (family === 4) return v4Problem(ip, allowPrivate);
  if (family !== 6) return "not an IP address";
  const g = v6Groups(ip);
  if (!g) return "not an IP address";
  // ::ffff:a.b.c.d (mapped) and 64:ff9b::a.b.c.d (NAT64) reach an IPv4 address.
  const embedded = `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4Problem(embedded, allowPrivate);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4Problem(embedded, allowPrivate);
  if (g.every((x) => x === 0)) return "an unreachable address (::)";
  if ((g[0]! & 0xffc0) === 0xfe80) return "a link-local address (fe80::/10)";
  if ((g[0]! & 0xff00) === 0xff00) return "a multicast address";
  if (g[0] === 0xfd00 && g[1] === 0x0ec2) return "a cloud metadata address";
  if (allowPrivate) return null;
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return "this server itself";
  if ((g[0]! & 0xfe00) === 0xfc00) return "a private network address (fc00::/7)";
  if (g[0] === 0x2001 && g[1] === 0x0db8) return "a documentation address";
  return null;
}

export type PublicUrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

export interface PublicUrlOptions {
  // TROUPE_LIBRARY_ALLOW_PRIVATE_URLS: the LAN and this machine too (never
  // link-local or metadata addresses).
  allowPrivate?: boolean;
  // The DNS lookup to guard (the system's by default; tests pass their own).
  lookup?: typeof dnsLookup;
}

export function checkPublicUrl(raw: string, options: PublicUrlOptions = {}): PublicUrlCheck {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, reason: "That is not a link. Paste the whole address, such as https://www.youtube.com/shorts/…" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "Only http:// and https:// links can be saved." };
  if (url.username || url.password) return { ok: false, reason: "Remove the user name and password from the link." };
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
  if (METADATA_HOSTS.has(host) || host === "169.254.169.254") return { ok: false, reason: "Cloud metadata addresses are not allowed." };
  if (isIP(host)) {
    const problem = checkPublicAddress(host, options);
    if (problem) return { ok: false, reason: `That link points at ${problem}, which the library does not fetch.` };
  } else if (!options.allowPrivate && (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local") || !host.includes("."))) {
    return { ok: false, reason: "That link points at this server or your network, which the library does not fetch. Use a public link, or upload the file." };
  }
  if (!options.allowPrivate && !PORTS.has(url.port)) return { ok: false, reason: `Links on port ${url.port} are not fetched; use the site's usual address.` };
  return { ok: true, url };
}

// A DNS lookup that refuses names resolving to a forbidden address, used by
// every connection the library opens.
function guardedLookup(options: PublicUrlOptions): LookupFunction {
  return (hostname, lookupOptions, callback) => {
    (options.lookup ?? dnsLookup)(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
      if (error) return callback(error, "", 4);
      const list = addresses as unknown as LookupAddress[];
      for (const entry of list) {
        const problem = checkPublicAddress(entry.address, options);
        if (problem) return callback(Object.assign(new Error(`${hostname} resolves to ${problem}`), { code: "TROUPE_FORBIDDEN_ADDRESS" }), "", 4);
      }
      if ((lookupOptions as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
      const first = list[0];
      if (!first) return callback(Object.assign(new Error(`${hostname} has no address`), { code: "ENOTFOUND" }), "", 4);
      callback(null, first.address, first.family);
    });
  };
}

export class FetchRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchRefused";
  }
}

export interface PublicResponse {
  url: URL;
  status: number;
  contentType: string;
  contentLength: number | null;
  body: IncomingMessage;
  // More time for the body than the exchange's deadline (a large file).
  keepFor(ms: number): void;
}

const USER_AGENT = "Mozilla/5.0 (compatible; TroupeLibrary/1.0; +https://github.com/maxgfr/troupe)";

// GET a public link: redirects followed by hand (at most 5), each hop
// checked, every connection's addresses checked. The caller reads `body`
// with its own size limit, then destroys it. The whole exchange, the body
// included, ends within `timeoutMs` (unless the caller gives the body more
// with keepFor): a server that sends a byte now and then never trips the
// socket's idle timeout, but does trip this one.
export async function openPublicUrl(raw: string, options: PublicUrlOptions & { timeoutMs: number; accept?: string; signal?: AbortSignal }): Promise<PublicResponse> {
  const lookup = guardedLookup(options);
  const current: { host: string; request?: ClientRequest; response?: IncomingMessage } = { host: "" };
  let timer: NodeJS.Timeout | undefined;
  const arm = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const reason = new FetchRefused(`${current.host} took longer than ${Math.max(1, Math.round(ms / 1000))} s to answer.`);
      if (current.response) current.response.destroy(reason);
      else current.request?.destroy(reason);
    }, ms);
  };
  arm(options.timeoutMs);
  try {
    return await follow();
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }

  async function follow(): Promise<PublicResponse> {
    let target = raw;
    for (let hop = 0; hop <= 5; hop++) {
      const checked = checkPublicUrl(target, options);
      if (!checked.ok) throw new FetchRefused(checked.reason);
      const url = checked.url;
      current.host = url.host;
      current.response = undefined;
      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
          url,
          { method: "GET", lookup, headers: { "user-agent": USER_AGENT, accept: options.accept ?? "*/*", "accept-encoding": "identity" }, signal: options.signal, timeout: options.timeoutMs },
          resolve,
        );
        current.request = request;
        request.on("timeout", () => request.destroy(new FetchRefused(`${url.host} took longer than ${Math.round(options.timeoutMs / 1000)} s to answer.`)));
        request.on("error", (error: Error & { code?: string }) => {
          if (error.code === "TROUPE_FORBIDDEN_ADDRESS") reject(new FetchRefused(`That link leads to ${error.message.replace(/^.* resolves to /, "")}, which the library does not fetch.`));
          else if (error instanceof FetchRefused) reject(error);
          else reject(new FetchRefused(`${url.host} could not be reached (${error.code ?? error.message}).`));
        });
        request.end();
      });
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        target = new URL(response.headers.location, url).toString();
        continue;
      }
      current.response = response;
      response.once("close", () => clearTimeout(timer));
      const length = Number(response.headers["content-length"]);
      return { url, status, contentType: (response.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase(), contentLength: Number.isFinite(length) ? length : null, body: response, keepFor: arm };
    }
    throw new FetchRefused("That link redirects too many times.");
  }
}

// The whole body, refused past `maxBytes`.
export async function readLimited(body: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) {
      body.destroy();
      throw new FetchRefused(`The page is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
