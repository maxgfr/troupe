// A picture as bytes, framed for a video: shared by the self-hosted studio
// (actor-pictures.ts, ffmpeg) and the browser edition (a canvas). No Node
// built-ins.

export interface PictureBytes {
  data: Uint8Array;
  mediaType: string;
}

// The crop of a w×h picture to the W:H format: the whole width or height,
// centred across, and from a little above the middle down, where a portrait
// keeps the face. Null when the picture already has that format.
export function cropFor(width: number, height: number, aspectRatio: string) {
  const [w, h] = aspectRatio.split(":").map(Number);
  if (!w || !h) return null;
  const target = w / h;
  if (Math.abs(width / height - target) < 0.01) return null;
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  if (width / height > target) {
    const cw = even(height * target);
    return { width: cw, height: even(height), x: Math.floor((width - cw) / 2), y: 0 };
  }
  const ch = even(width / target);
  return { width: even(width), height: ch, x: 0, y: Math.floor((height - ch) * 0.3) };
}

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export const dataUrl = (picture: PictureBytes) => `data:${picture.mediaType};base64,${base64(picture.data)}`;
