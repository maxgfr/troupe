import type { Emotion, LineRole } from "~/modules/script";
import { paletteFor, type Palette } from "./palette";

// A scene is everything needed to draw any frame of a rendered script: the
// frame size, the actor's colors, where things sit, and when each line and
// word is said. Pure data, so the browser and Node renderers share it.

export interface SceneLine {
  role: LineRole;
  text: string;
  emotion: Emotion;
}

export interface SceneActor {
  id: string;
  name: string;
}

export interface SceneInput {
  width: number;
  height: number;
  fps?: number;
  actor: SceneActor;
  // In speaking order.
  lines: SceneLine[];
  // Seconds of speech per line, as measured from the voice. Unset: estimated
  // from the word count, like the script's own duration estimate.
  speechS?: number[];
}

export interface Word {
  text: string;
  startS: number;
  endS: number;
}

export interface Cue extends SceneLine {
  index: number;
  startS: number;
  endS: number;
  words: Word[];
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  // The most room the card may take; it is drawn as wide as its content.
  card: Box;
  portrait: { cx: number; cy: number; r: number };
  captions: Box;
  // Where captions go when they are laid over a video (drawFrame's
  // captionsOnly): the lower third, below the speaker's face.
  overlayCaptions: Box;
  // Font sizes in pixels. Captions start at captionSize and shrink to fit.
  nameSize: number;
  captionSize: number;
  // Inner spacing of the card.
  padding: number;
}

export interface Scene {
  width: number;
  height: number;
  fps: number;
  durationS: number;
  actor: SceneActor & { initials: string };
  palette: Palette;
  layout: Layout;
  cues: Cue[];
}

// Silence before the first line, between lines and after the last one.
export const TIMING = { leadInS: 0.3, gapS: 0.35, tailS: 0.6 } as const;
// The pace a line without a measured voice is timed at.
export const WORDS_PER_SECOND = 2.5;

export function actorInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

// Each word gets a share of the line proportional to its length.
function timeWords(text: string, startS: number, endS: number): Word[] {
  const words = splitWords(text);
  const weights = words.map((w) => w.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = startS;
  return words.map((word, i) => {
    const wordEnd = i === words.length - 1 ? endS : cursor + ((endS - startS) * weights[i]!) / total;
    const timed = { text: word, startS: cursor, endS: wordEnd };
    cursor = wordEnd;
    return timed;
  });
}

function layoutFor(width: number, height: number): Layout {
  const s = Math.min(width, height);
  const margin = 0.06 * s;
  const diameter = 0.18 * s;
  const padding = 0.035 * s;
  const vertical = height > width;
  // Vertical video keeps clear of what TikTok, Reels and Shorts draw over it:
  // the feed tabs at the top, the like/share rail on the right and the
  // caption and description in the bottom fifth.
  const card = { x: margin, y: vertical ? 0.11 * height : margin, width: width - 2 * margin, height: diameter + 2 * padding };
  const captionsTop = vertical ? 0.42 * height : card.y + card.height + margin;
  const captionsBottom = vertical ? 0.78 * height : height - margin;
  const captionsRight = vertical ? 0.86 * width : width - margin;
  // Over a talking head the face fills the upper half: keep the words below
  // the chin, above the platforms' own text on vertical video.
  const overlayTop = (vertical ? 0.62 : 0.66) * height;
  const overlayBottom = vertical ? captionsBottom : height - margin;
  return {
    card,
    portrait: { cx: card.x + padding + diameter / 2, cy: card.y + card.height / 2, r: diameter / 2 },
    captions: { x: margin, y: captionsTop, width: captionsRight - margin, height: captionsBottom - captionsTop },
    overlayCaptions: { x: margin, y: overlayTop, width: captionsRight - margin, height: overlayBottom - overlayTop },
    nameSize: 0.06 * s,
    captionSize: 0.08 * s,
    padding,
  };
}

export function buildScene(input: SceneInput): Scene {
  if (input.lines.length === 0) throw new Error("A scene needs at least one line.");
  if (input.speechS && input.speechS.length !== input.lines.length) {
    throw new Error(`Got ${input.speechS.length} speech lengths for ${input.lines.length} lines.`);
  }
  let cursor: number = TIMING.leadInS;
  const cues = input.lines.map((line, index) => {
    const speech = input.speechS?.[index] ?? Math.max(1, splitWords(line.text).length) / WORDS_PER_SECOND;
    const startS = index === 0 ? cursor : cursor + TIMING.gapS;
    const endS = startS + speech;
    cursor = endS;
    return { index, ...line, startS, endS, words: timeWords(line.text, startS, endS) };
  });
  return {
    width: input.width,
    height: input.height,
    fps: input.fps ?? 24,
    durationS: cursor + TIMING.tailS,
    actor: { ...input.actor, initials: actorInitials(input.actor.name) },
    palette: paletteFor(input.actor.id),
    layout: layoutFor(input.width, input.height),
    cues,
  };
}

// The line on screen at time t: the first one during the lead-in, then each
// line until the next one starts, and the last one until the end.
export function cueAt(scene: Scene, t: number): Cue | undefined {
  let current = scene.cues[0];
  for (const cue of scene.cues) if (cue.startS <= t) current = cue;
  return current;
}
