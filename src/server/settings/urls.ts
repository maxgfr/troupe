// Where a local model may live. Loopback and private networks are fine — a
// GPU box on the LAN or a ComfyUI container is the point — but link-local
// ranges and cloud metadata endpoints are refused so a model URL can never
// be used to read the host's cloud credentials.
//
// This checks the address as written. A public hostname that resolves to a
// metadata address is not caught here; the server only ever sends the
// model's own token to it.

const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
  "instance-data",
  "instance-data.ec2.internal",
  "100.100.100.200", // Alibaba Cloud
  "fd00:ec2::254", // AWS IPv6
  "169.254.169.254",
  "169.254.170.2", // ECS task metadata
]);

export type UrlCheck = { ok: true; base: string } | { ok: false; reason: string };

function ipv4Parts(host: string) {
  return host.split(".").map(Number);
}

// The host as it will be dialled: without brackets or a trailing dot, and an
// IPv4-mapped IPv6 address (::ffff:a9fe:a9fe) turned back into IPv4.
function canonicalHost(hostname: string) {
  const host = hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .toLowerCase();
  const mapped = /^::ffff:(?:([0-9.]+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(host);
  if (!mapped) return host;
  if (mapped[1]) return mapped[1];
  const hi = Number.parseInt(mapped[2]!, 16);
  const lo = Number.parseInt(mapped[3]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

// The IP family of a host taken from a parsed URL (0 for a name). The URL
// parser has already turned every IPv4 spelling into a dotted quad and
// bracketed every IPv6 address, the only hosts with a colon. No node:net, so
// the check also runs in the browser edition.
function ipFamily(host: string): 0 | 4 | 6 {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return 4;
  return host.includes(":") ? 6 : 0;
}

export function checkLocalUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Enter a valid URL, such as http://127.0.0.1:8188." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { ok: false, reason: "Use an http:// or https:// address." };
  if (url.username || url.password)
    return { ok: false, reason: "Remove the credentials from the URL; use the token field instead." };
  const host = canonicalHost(url.hostname);
  if (METADATA_HOSTS.has(host)) return { ok: false, reason: "Cloud metadata addresses are not allowed." };
  const family = ipFamily(host);
  if (family === 4) {
    const [a, b] = ipv4Parts(host);
    if (a === 169 && b === 254) return { ok: false, reason: "Link-local addresses (169.254.x.x) are not allowed." };
    if (a === 0)
      return { ok: false, reason: "0.0.0.0 is not a reachable address; use 127.0.0.1 or the machine's LAN address." };
  }
  if (family === 6 && /^fe[89ab][0-9a-f]:/.test(host))
    return { ok: false, reason: "Link-local IPv6 addresses (fe80::/10) are not allowed." };
  if (family === 6 && (host === "::" || host === "0:0:0:0:0:0:0:0"))
    return { ok: false, reason: ":: is not a reachable address." };
  return { ok: true, base: `${url.origin}${url.pathname.replace(/\/+$/, "")}` };
}

// The machine Troupe's server runs on, as the request context describes it
// (src/server/api/local-context.ts). The browser edition has none.
export interface Machine {
  inContainer: boolean;
  platform: NodeJS.Platform;
}

// Where ComfyUI most likely answers, to prefill the "add a local model" form.
// Inside a container 127.0.0.1 is the container itself, so ComfyUI on the
// host is host.docker.internal (docker-compose.yml maps it). Outside one,
// ComfyUI Desktop, the usual install on a Mac, listens on port 8000, and
// ComfyUI started from the command line on 8188.
export function suggestedComfyUrl({ inContainer, platform }: Machine): string {
  if (inContainer) return "http://host.docker.internal:8188";
  return platform === "darwin" ? "http://127.0.0.1:8000" : "http://127.0.0.1:8188";
}

export function sameOrigin(candidate: string, base: string): boolean {
  try {
    return new URL(candidate).origin === new URL(base).origin;
  } catch {
    return false;
  }
}
