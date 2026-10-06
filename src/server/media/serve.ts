import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { mediaFilePath } from "./storage";
import { mediaDisposition } from "./store";

// `download`: the URL's download query (null to play inline), see mediaDisposition.
// `as` serves another stored type (the library's files) than a render's MP4.
export async function serveMediaFile(
  storagePath: string,
  range: string | null,
  download: string | null,
  as?: { contentType: string; disposition: string },
) {
  const file = mediaFilePath(storagePath);
  const size = (await stat(file)).size;
  const headers = new Headers({
    "content-type": as?.contentType ?? "video/mp4",
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-disposition": as?.disposition ?? mediaDisposition(download),
    // Nothing served here is a page: even a file that slipped past the type
    // checks could not run as one.
    "content-security-policy": "default-src 'none'; sandbox",
  });
  let start = 0,
    end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    } else {
      start = Math.max(0, size - Number(match[2]));
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size)
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    headers.set("content-range", `bytes ${start}-${end}/${size}`);
  }
  headers.set("content-length", String(end - start + 1));
  return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
    status: range ? 206 : 200,
    headers,
  });
}
