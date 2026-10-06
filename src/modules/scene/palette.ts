// Colors for an actor's scene, derived from the same hue as the portrait in
// the app (ActorPortrait). Colors are converted to sRGB here, not left as
// oklch() strings, so the browser and Node canvases paint the same pixels.

// Deterministic hue in [0, 360) from the actor id.
export function actorHue(id: string): number {
  return [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
}

function toSrgb(linear: number): number {
  const v = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

// oklch(l c h) as "#rrggbb", or "rgba(r, g, b, a)" with an alpha. Colors
// outside sRGB are clipped per channel; the palette stays inside it.
export function oklch(l: number, c: number, h: number, alpha?: number): string {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1,
    -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1,
    -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1,
  ].map(toSrgb);
  if (alpha !== undefined) return `rgba(${rgb.join(", ")}, ${alpha})`;
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export interface Palette {
  backgroundTop: string;
  backgroundBottom: string;
  glow: string;
  glowFade: string;
  card: string;
  // The portrait disc and its initials, as ActorPortrait paints them.
  portrait: string;
  portraitInk: string;
  // Caption words already said and still to come.
  ink: string;
  inkMuted: string;
  // The pill behind the word being said (ink on it reads at 4:1), and the
  // ring around the portrait while the actor speaks.
  highlight: string;
  // Captions laid over a video: the band behind them, its faded edges, and
  // the words still to come, brighter than inkMuted to read on any picture.
  shade: string;
  shadeFade: string;
  inkMutedOver: string;
}

// One hue for every actor instead of each one's own (SCENE_HUE in the Node
// renderer, VITE_SCENE_HUE in the browser edition): a whole number of
// degrees from 0 to 359, or undefined when unset.
export function parseSceneHue(raw: string | undefined): number | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const hue = Number(value);
  if (!/^\d+$/.test(value) || hue > 359) throw new Error(`The scene hue must be a whole number of degrees from 0 to 359 (got "${value}").`);
  return hue;
}

// The actor's palette, in its own hue unless `hue` sets one for everyone.
export function paletteFor(actorId: string, hue: number = actorHue(actorId)): Palette {
  return {
    backgroundTop: oklch(0.26, 0.05, hue),
    backgroundBottom: oklch(0.13, 0.03, (hue + 40) % 360),
    glow: oklch(0.55, 0.1, hue, 0.35),
    glowFade: oklch(0.55, 0.1, hue, 0),
    card: oklch(0.18, 0.03, hue, 0.72),
    portrait: oklch(0.3, 0.05, hue),
    portraitInk: oklch(0.92, 0.02, hue),
    ink: oklch(0.97, 0.01, hue),
    inkMuted: oklch(0.97, 0.01, hue, 0.55),
    highlight: oklch(0.58, 0.12, hue),
    shade: oklch(0.13, 0.03, hue, 0.68),
    shadeFade: oklch(0.13, 0.03, hue, 0),
    inkMutedOver: oklch(0.97, 0.01, hue, 0.72),
  };
}
