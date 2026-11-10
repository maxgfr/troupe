// What a provider's file really is, read from its bytes. No Node built-ins:
// the browser edition reads them the same way.

// The kinds of file a provider may send back, by their first bytes.
const SIGNATURES: { mime: string; ext: string; test: (b: Uint8Array) => boolean }[] = [
  { mime: "image/png", ext: "png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", ext: "webp", test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP" },
  { mime: "audio/wav", ext: "wav", test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE" },
  { mime: "audio/ogg", ext: "ogg", test: (b) => ascii(b, 0, 4) === "OggS" },
  { mime: "audio/flac", ext: "flac", test: (b) => ascii(b, 0, 4) === "fLaC" },
  { mime: "audio/mp4", ext: "m4a", test: (b) => ascii(b, 4, 8) === "ftyp" },
  {
    mime: "audio/mpeg",
    ext: "mp3",
    test: (b) => ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0),
  },
];

function ascii(b: Uint8Array, from: number, to: number) {
  return String.fromCharCode(...b.subarray(from, to));
}

// The file's real type from its bytes, never from what the provider said.
export function sniffMedia(bytes: Uint8Array, medium: "image" | "speech") {
  const found = SIGNATURES.find((s) => s.test(bytes));
  if (!found || (medium === "image") !== found.mime.startsWith("image/")) return null;
  return found;
}

// A PNG's, JPEG's or WebP's size in pixels, read from its header.
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 24 && bytes[0] === 0x89) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length > 30 && ascii(bytes, 8, 12) === "WEBP") {
    const chunk = ascii(bytes, 12, 16);
    if (chunk === "VP8X")
      return { width: 1 + (view.getUint32(24, true) & 0xffffff), height: 1 + (view.getUint32(27, true) & 0xffffff) };
    if (chunk === "VP8 ")
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1]!;
      const length = view.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
      i += 2 + length;
    }
  }
  return null;
}
