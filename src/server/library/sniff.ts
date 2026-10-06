// What a file is, read from its first bytes rather than its name or the
// type the client claimed. Only types the library analyses get a name;
// anything else, HTML and SVG above all (served from the studio's origin they
// would run as its pages), is refused.

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

export const SNIFF_BYTES = 4096;

export function sniffType(head: Uint8Array): string | null {
  if (head.length < 3) return head.length > 0 ? textType(head) : null;
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (brand === "qt  ") return "video/quicktime";
    if (brand === "M4A " || brand === "M4B " || brand === "M4P ") return "audio/mp4";
    return "video/mp4";
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video/webm";
  if (ascii(head, 0, 3) === "ID3") return "audio/mpeg";
  if (head[0] === 0xff && (head[1]! & 0xf6) === 0xf0) return "audio/aac";
  if (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) return "audio/mpeg";
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF") {
    const form = ascii(head, 8, 12);
    if (form === "WAVE") return "audio/wav";
    if (form === "WEBP") return "image/webp";
    return null;
  }
  if (ascii(head, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(head, 0, 4) === "fLaC") return "audio/flac";
  if (head[0] === 0x89 && ascii(head, 1, 4) === "PNG") return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(head, 0, 5) === "%PDF-") return "application/pdf";
  return textType(head);
}

export const EMPTY_FILE = "The file is empty.";
export const UNREAD_FILE =
  "This file is not one the library reads: use a video, a sound file, a picture (PNG, JPEG, WebP, GIF), a PDF or plain text.";

// Why the library cannot save a file, from its size and first bytes, or null:
// the same answer from the studio's upload route and the browser edition.
export function fileRefusal(size: number, head: Uint8Array): string | null {
  if (size === 0) return EMPTY_FILE;
  return sniffType(head) ? null : UNREAD_FILE;
}

// UTF-8 text with no control characters but tabs and line breaks, that does
// not open like markup.
function textType(head: Uint8Array): string | null {
  let text: string;
  try {
    // `stream`: a character cut at the end of the sample is not an error.
    text = new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
  } catch {
    return null;
  }
  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(text)) return null;
  const start = text.replace(/^\uFEFF/, "").trimStart();
  if (!start || start.startsWith("<")) return null;
  return "text/plain";
}

// The extension a stored file gets, from its sniffed type.
export const EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
};
