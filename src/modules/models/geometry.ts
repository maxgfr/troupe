// Pixel geometry for models that take explicit sizes and frame counts
// (local ComfyUI workflows, HTTP endpoints). Cloud APIs take labels instead.

const SHORT_SIDE: Record<string, number> = { "480p": 480, "540p": 540, "576p": 576, "720p": 720, "1080p": 1080 };
const RATIOS: Record<string, [number, number]> = { "9:16": [9, 16], "16:9": [16, 9], "1:1": [1, 1] };

export type FrameRule = "any" | "4n+1" | "8n+1";

export function sizeFor(
  aspectRatio: string,
  resolution: string,
  opts: { multiple?: number; table?: Record<string, [number, number]> } = {},
): { width: number; height: number } {
  const fixed = opts.table?.[`${aspectRatio}@${resolution}`];
  if (fixed) return { width: fixed[0], height: fixed[1] };
  const ratio = RATIOS[aspectRatio];
  if (!ratio) throw new Error(`Unsupported aspect ratio ${aspectRatio}.`);
  const short = SHORT_SIDE[resolution];
  if (!short) throw new Error(`Unsupported resolution ${resolution}.`);
  const multiple = opts.multiple ?? 8;
  const snap = (v: number) => Math.max(multiple, Math.round(v / multiple) * multiple);
  const [w, h] = ratio;
  const long = (short * Math.max(w, h)) / Math.min(w, h);
  // The short side is the resolution label; keep it exact when it already fits.
  const shortSide = short % multiple === 0 ? short : snap(short);
  if (w === h) return { width: shortSide, height: shortSide };
  return w > h ? { width: snap(long), height: shortSide } : { width: shortSide, height: snap(long) };
}

export function framesFor(durationS: number, fps: number, rule: FrameRule): number {
  const base = Math.round(durationS * fps);
  if (rule === "any") return base;
  const step = rule === "4n+1" ? 4 : 8;
  return Math.max(1, Math.round((base - 1) / step)) * step + 1;
}
