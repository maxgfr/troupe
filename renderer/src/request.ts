import type { SceneLine, VoiceActor } from "../../src/modules/scene";
import type { Emotion, LineRole } from "~/modules/script";

// A POST /jobs body (docs/LOCAL-MODELS.md), checked and reduced to what the
// renderer needs. Troupe sends `script`; without it the dialogue is read
// back from `prompt`, in the format compilePrompt() writes.

export interface RenderRequest {
  width: number;
  height: number;
  fps: number;
  audio: boolean;
  language: string;
  actor: VoiceActor & { name: string };
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
const EMOTIONS: Record<Emotion, true> = { neutral: true, excited: true, calm: true, serious: true, happy: true, disappointed: true };
const GENDERS = ["female", "male", "nonbinary"] as const;
const isRole = (v: unknown): v is LineRole => typeof v === "string" && Object.hasOwn(ROLES, v);
const isEmotion = (v: unknown): v is Emotion => typeof v === "string" && Object.hasOwn(EMOTIONS, v);

const record = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function size(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 64 || n > 3840) throw new BadRequest(`${name} must be a whole number of pixels between 64 and 3840.`);
  // H.264 in yuv420p needs even sides.
  if (n % 2 !== 0) throw new BadRequest(`${name} must be even.`);
  return n;
}

function scriptLines(value: unknown): SceneLine[] {
  if (!Array.isArray(value) || value.length === 0) throw new BadRequest("script.lines needs at least one line.");
  return value.map((raw, i) => {
    const line = record(raw);
    if (!line || !isRole(line.role)) throw new BadRequest(`script.lines[${i}].role must be hook, body or cta.`);
    if (!isEmotion(line.emotion)) throw new BadRequest(`script.lines[${i}].emotion must be one of ${Object.keys(EMOTIONS).join(", ")}.`);
    if (!text(line.text)) throw new BadRequest(`script.lines[${i}].text is empty.`);
    return { role: line.role, text: text(line.text), emotion: line.emotion };
  });
}

function fromScript(value: unknown): Pick<RenderRequest, "language" | "actor" | "lines"> {
  const script = record(value);
  if (!script) throw new BadRequest("script must be an object.");
  const actor = record(script.actor);
  if (!actor || !text(actor.id) || typeof actor.name !== "string") throw new BadRequest("script.actor needs an id and a name.");
  const gender = GENDERS.find((g) => g === actor.gender);
  return {
    language: text(script.language) || "en",
    actor: {
      id: text(actor.id),
      name: actor.name.trim(),
      ...(gender ? { gender } : {}),
      ...(text(actor.voice_profile) ? { voiceProfile: text(actor.voice_profile) } : {}),
    },
    lines: scriptLines(script.lines),
  };
}

// compilePrompt() writes "Voice: <profile>. Language: <code>." then one
// "[emotion] (role) text" line per script line.
function fromPrompt(prompt: string): Pick<RenderRequest, "language" | "actor" | "lines"> {
  const voice = /^Voice: (.*)\. Language: ([\w-]+)\.$/m.exec(prompt);
  const lines: SceneLine[] = [];
  for (const match of prompt.matchAll(/^\[(\w+)\] \((\w+)\) (.+)$/gm)) {
    const [, emotion, role, said] = match;
    if (isRole(role) && said?.trim()) lines.push({ role, text: said.trim(), emotion: isEmotion(emotion) ? emotion : "neutral" });
  }
  const voiceProfile = voice?.[1]?.trim();
  return {
    language: voice?.[2] ?? "en",
    // No actor without a script: the voice profile keys the colors and voice.
    actor: { id: `prompt:${voiceProfile ?? ""}`, name: "Narrator", ...(voiceProfile ? { voiceProfile } : {}) },
    lines: lines.length > 0 ? lines : [{ role: "hook", text: prompt.trim(), emotion: "neutral" }],
  };
}

export function parseJobBody(body: unknown): RenderRequest {
  const input = record(body);
  if (!input) throw new BadRequest("The body must be a JSON object.");
  if (!text(input.prompt) || !input.width || !input.height || !input.duration_s) throw new BadRequest("prompt, width, height and duration_s are required");
  const fps = input.fps === undefined ? 24 : Number(input.fps);
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new BadRequest("fps must be a whole number between 1 and 60.");
  return {
    width: size(input.width, "width"),
    height: size(input.height, "height"),
    fps,
    audio: input.audio !== false,
    ...(input.script === undefined ? fromPrompt(text(input.prompt)) : fromScript(input.script)),
  };
}
