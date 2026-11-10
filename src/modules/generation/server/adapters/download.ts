export const CLOUD_DOWNLOAD_LIMIT = 50 * 1024 * 1024;

export async function videoBytes(response: Response, maxBytes = CLOUD_DOWNLOAD_LIMIT): Promise<Uint8Array> {
  if (!response.ok || !response.body) throw new Error("Video download failed; it will be retried.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > maxBytes) throw new Error(`Video exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB download limit.`);
    chunks.push(chunk);
  }
  // Plain Uint8Arrays, no Buffer: the browser edition downloads with it too.
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(4, 8)) !== "ftyp")
    throw new Error("Provider returned an invalid MP4 file.");
  return bytes;
}

export async function downloadFalVideo(address: string) {
  let url = new URL(address);
  for (let redirects = 0; redirects < 4; redirects++) {
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      !(
        url.hostname === "fal.media" ||
        url.hostname.endsWith(".fal.media") ||
        url.hostname === "storage.googleapis.com"
      )
    ) {
      throw new Error("Unrecognized video storage address.");
    }
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location");
      if (!next) throw new Error("Video redirect has no location.");
      url = new URL(next, url);
      continue;
    }
    return videoBytes(response);
  }
  throw new Error("Too many video redirects.");
}
