import { type SceneLine, TIMING, type VoiceActor, WORDS_PER_SECOND } from "../../src/modules/scene";
import type { Emotion, LineRole } from "~/modules/script";

// A POST /jobs body (docs/LOCAL-MODELS.md), checked and reduced to what the
// renderer needs. Troupe sends `script`; without it the dialogue is read
// back from `prompt`, in the format compilePrompt() writes.

export interface RenderRequest {
  width: number;
  height: number;
  fps: number;
  audio: boolean;
  // ageRange describes the actor to a video model (render-ltx.ts);
  // portraits are the actor's pictures by shot (front, happy, …), as paths
  // under the portraits folder (portraits.ts).
  actor: VoiceActor & { name: string; ageRange?: string; portraits?: Record<string, string> };
  lines: SceneLine[];
}

export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequest";
  }
}

// Records keep these lists in step with the script module's types.
const ROLES: Record<LineRole, true> = { hook: true, body: true, cta: true };
const EMOTIONS: Record<Emotion, true> = {
  neutral: true,
  excited: true,
  calm: true,
  serious: true,
  happy: true,
  disappointed: true,
};
const GENDERS = ["female", "male", "nonbinary"] as const;
const isRole = (v: unknown): v is LineRole => typeof v === "string" && Object.hasOwn(ROLES, v);
const isEmotion = (v: unknown): v is Emotion => typeof v === "string" && Object.hasOwn(EMOTIONS, v);

// actors/<slug>/v<version>/<file>, as Troupe stores them: nothing that could
// leave the portraits folder.
const PORTRAIT_PATH = /^actors\/[a-z0-9][a-z0-9-]*\/v\d+\/[a-z0-9][a-z0-9-]*\.(webp|png|jpe?g)$/;

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function size(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 64 || n > 3840)
    throw new BadRequest(`${name} must be a whole number of pixels between 64 and 3840.`);
  // H.264 in yuv420p needs even sides.
  if (n % 2 !== 0) throw new BadRequest(`${name} must be even.`);
  return n;
}

function scriptLines(value: unknown): SceneLine[] {
  if (!Array.isArray(value) || value.length === 0) throw new BadRequest("script.lines needs at least one line.");
  return value.map((raw, i) => {
    const line = record(raw);
    if (!line || !isRole(line.role)) throw new BadRequest(`script.lines[${i}].role must be hook, body or cta.`);
    if (!isEmotion(line.emotion))
      throw new BadRequest(`script.lines[${i}].emotion must be one of ${Object.keys(EMOTIONS).join(", ")}.`);
    if (!text(line.text)) throw new BadRequest(`script.lines[${i}].text is empty.`);
    return { role: line.role, text: text(line.text), emotion: line.emotion };
  });
}

// A Kokoro voice id such as af_heart; anything else is ignored and the
// actor's id picks the voice.
const VOICE_ID = /^[a-z]{2}_[a-z0-9]+$/;

// Anything that could step out of the portraits folder refuses the job.
const ESCAPES = /(^|[\\/])\.\.([\\/]|$)|^[\\/]|\\/;

// The pictures the renderer can use; an entry it cannot (another layout, a
// type it does not draw) is dropped and logged, and the card falls back.
function portraits(value: unknown, log: (message: string) => void): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const shots = record(value);
  if (!shots) {
    log("script.actor.portraits is not an object of shot names to paths: drawing the initials.");
    return undefined;
  }
  const kept: Record<string, string> = {};
  for (const [shot, path] of Object.entries(shots)) {
    if (typeof path === "string" && ESCAPES.test(path))
      throw new BadRequest(`script.actor.portraits.${shot} must stay in the portraits folder.`);
    if (typeof path === "string" && PORTRAIT_PATH.test(path)) kept[shot] = path;
    else log(`Ignoring script.actor.portraits.${shot}: expected a path like actors/<actor>/v1/front.webp.`);
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

type Spoken = Pick<RenderRequest, "actor" | "lines"> & { language: string };

function fromScript(value: unknown, log: (message: string) => void): Spoken {
  const script = record(value);
  if (!script) throw new BadRequest("script must be an object.");
  const actor = record(script.actor);
  if (!actor || !text(actor.id) || typeof actor.name !== "string")
    throw new BadRequest("script.actor needs an id and a name.");
  const gender = GENDERS.find((g) => g === actor.gender);
  const pictures = portraits(actor.portraits, log);
  return {
    language: text(script.language) || "en",
    actor: {
      id: text(actor.id),
      name: actor.name.trim(),
      ...(gender ? { gender } : {}),
      ...(text(actor.age_range) ? { ageRange: text(actor.age_range) } : {}),
      ...(text(actor.voice_profile) ? { voiceProfile: text(actor.voice_profile) } : {}),
      ...(VOICE_ID.test(text(actor.voice)) ? { voice: text(actor.voice) } : {}),
      ...(pictures ? { portraits: pictures } : {}),
    },
    lines: scriptLines(script.lines),
  };
}

// compilePrompt() writes "Voice: <profile>. Language: <code>." then one
// "[emotion] (role) text" line per script line.
function fromPrompt(prompt: string): Spoken {
  const voice = /^Voice: (.*)\. Language: ([\w-]+)\.$/m.exec(prompt);
  const lines: SceneLine[] = [];
  for (const match of prompt.matchAll(/^\[(\w+)\] \((\w+)\) (.+)$/gm)) {
    const [, emotion, role, said] = match;
    if (isRole(role) && said?.trim())
      lines.push({ role, text: said.trim(), emotion: isEmotion(emotion) ? emotion : "neutral" });
  }
  const voiceProfile = voice?.[1]?.trim();
  return {
    language: voice?.[2] ?? "en",
    // No actor without a script: the voice profile keys the colors and voice.
    actor: { id: `prompt:${voiceProfile ?? ""}`, name: "Narrator", ...(voiceProfile ? { voiceProfile } : {}) },
    lines: lines.length > 0 ? lines : [{ role: "hook", text: prompt.trim(), emotion: "neutral" }],
  };
}

// Troupe keeps a script within the clip length, but a prompt from another
// client can hold any amount of text: its dialogue is cut to about this many
// times duration_s, timed at the pace of a line without a voice.
export const PROMPT_LENGTH_SLACK = 1.5;

function capToDuration(lines: SceneLine[], durationS: number, log: (message: string) => void): SceneLine[] {
  const maxS = durationS * PROMPT_LENGTH_SLACK;
  let words = (maxS - TIMING.leadInS - TIMING.tailS) * WORDS_PER_SECOND;
  const kept: SceneLine[] = [];
  for (const line of lines) {
    if (kept.length > 0) words -= TIMING.gapS * WORDS_PER_SECOND;
    const said = line.text.split(/\s+/).filter(Boolean);
    // At least the first word, whatever the length asked for.
    const room = Math.max(kept.length === 0 ? 1 : 0, Math.floor(words));
    if (room === 0) break;
    kept.push(said.length <= room ? line : { ...line, text: said.slice(0, room).join(" ") });
    words -= said.length;
    if (said.length > room) break;
  }
  const total = (ls: SceneLine[]) => ls.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
  if (total(kept) < total(lines)) {
    log(
      `The prompt's dialogue is longer than duration_s (${durationS} s) allows: reading its first ${total(kept)} of ${total(lines)} words, about ${maxS} s.`,
    );
  }
  return kept;
}

// `log` hears about parts of the job that were dropped rather than refused.
export function parseJobBody(body: unknown, log: (message: string) => void = () => {}): RenderRequest {
  const input = record(body);
  if (!input) throw new BadRequest("The body must be a JSON object.");
  if (!text(input.prompt) || !input.width || !input.height || !input.duration_s)
    throw new BadRequest("prompt, width, height and duration_s are required");
  const durationS = Number(input.duration_s);
  if (!Number.isFinite(durationS) || durationS <= 0)
    throw new BadRequest("duration_s must be a positive number of seconds.");
  const fps = input.fps === undefined ? 24 : Number(input.fps);
  if (!Number.isInteger(fps) || fps < 1 || fps > 60)
    throw new BadRequest("fps must be a whole number between 1 and 60.");
  const width = size(input.width, "width");
  const height = size(input.height, "height");
  const fromScriptOrPrompt =
    input.script === undefined ? fromPrompt(text(input.prompt)) : fromScript(input.script, log);
  const { language, actor } = fromScriptOrPrompt;
  // Kokoro only has English voices (docs/LOCAL-MODELS.md, Limits).
  if (!/^en\b/i.test(language))
    log(`Lines in "${language}" are read with English pronunciation: the Kokoro voices are English.`);
  const lines =
    input.script === undefined ? capToDuration(fromScriptOrPrompt.lines, durationS, log) : fromScriptOrPrompt.lines;
  return { width, height, fps, audio: input.audio !== false, actor, lines };
}
