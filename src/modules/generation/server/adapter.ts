import type { Emotion, LineRole } from "~/modules/script";

// Minimal fetch-shaped dependency so adapters are testable without network.
export type HttpLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type AudioSupport = "always" | "optional" | "none";

// What a model accepts. The UI builds its pickers from this, and every
// request is validated against it before any paid or long-running call.
export interface ModelCapabilities {
  aspectRatios: string[];
  resolutions: string[];
  durationsS: number[];
  audio: AudioSupport;
  // Languages the model is known to speak; null when not declared.
  dialogueLanguages: string[] | null;
}

export interface CreateJobRequest {
  prompt: string;
  aspectRatio: string;
  resolution: string;
  durationS: number;
  audio: boolean;
  // The script behind the prompt, for models that voice and stage it
  // themselves. Always set by launches; prompt-only models ignore it.
  script?: JobScript;
}

export interface JobScript {
  // In speaking order.
  lines: PromptLine[];
  actor: JobActor;
  // The language the lines are spoken in, e.g. "en".
  language: string;
}

// Enough to pick a voice and a portrait: the id is stable per actor.
export interface JobActor {
  id: string;
  name: string;
  gender: "female" | "male" | "nonbinary";
  ageRange: string;
  // Free-text delivery, e.g. "warm and enthusiastic, mid-tempo".
  voiceProfile: string;
  // The actor's current pictures by shot (front, profile-left,
  // profile-right, happy, calm, excited), as storage paths:
  // actors/<slug>/v<version>/<shot>.webp.
  portraits?: Record<string, string>;
}

// A failure with a stable code for the UI and a readable sentence. Messages
// never quote upstream response bodies.
export class AdapterError extends Error {
  constructor(
    public readonly code: string,
    public readonly detail: string,
  ) {
    super(detail);
    this.name = "AdapterError";
  }
}

function list(values: (string | number)[]) {
  const parts = values.map(String);
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} or ${parts.at(-1)}`;
}

export function validateRequest(caps: ModelCapabilities, req: Omit<CreateJobRequest, "prompt">): void {
  if (!caps.aspectRatios.includes(req.aspectRatio)) {
    throw new AdapterError(
      "UNSUPPORTED_ASPECT_RATIO",
      `This model renders ${list(caps.aspectRatios)} video, not the ${req.aspectRatio} format.`,
    );
  }
  if (!caps.resolutions.includes(req.resolution)) {
    throw new AdapterError(
      "UNSUPPORTED_RESOLUTION",
      `This model renders ${list(caps.resolutions)}, not ${req.resolution}.`,
    );
  }
  if (!caps.durationsS.includes(req.durationS)) {
    throw new AdapterError("UNSUPPORTED_DURATION", `Choose a ${list(caps.durationsS)} seconds clip for this model.`);
  }
  if (caps.audio === "always" && !req.audio) {
    throw new AdapterError("AUDIO_ALWAYS_ON", "This model always generates audio.");
  }
  if (caps.audio === "none" && req.audio) {
    throw new AdapterError("AUDIO_UNSUPPORTED", "This model generates silent video.");
  }
}

export type ModelFamily = "veo" | "fal" | "comfyui" | "http" | "browser";

// The provider job's current state, polled by the reconciler.
export type ProviderJobStatus = { kind: "pending"; progress?: number } | JobOutcome;

export interface ConnectionReport {
  // null: the check cannot tell without spending money.
  ok: boolean | null;
  message: string;
  details?: string[];
  // The polling pace the model asked for (HTTP contract: poll_every_s),
  // already clamped. Saved on the model so its renders are polled at it.
  pollEveryS?: number;
}

// A model's own polling pace, in whole seconds from 1 to 60; anything that
// is not a finite number means "no pace". Below a second, every reconcile
// pass would poll the job again.
export const POLL_EVERY_S_RANGE = { min: 1, max: 60 } as const;
export function clampPollEveryS(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(POLL_EVERY_S_RANGE.max, Math.max(POLL_EVERY_S_RANGE.min, Math.round(value)));
}

// The interface every video model implements.
export interface VideoProviderAdapter {
  // Stable catalog key: routes launches and polls.
  modelKey: string;
  family: ModelFamily;
  // Upstream model identifier, kept on each generation for attribution.
  modelId: string;
  capabilities(): ModelCapabilities;
  // Seconds between status polls, from the first one on, for models that
  // finish in seconds (clamped to 1–60). Unset: 20 s, then doubling up to
  // 5 minutes.
  pollEveryS?: number;
  createJob(req: CreateJobRequest): Promise<{ providerJobId: string }>;
  // Optional: a provider without it still gets the reconciler's timeout guard.
  getJob?(providerJobId: string): Promise<ProviderJobStatus>;
  downloadResult?(url: string): Promise<Uint8Array>;
  testConnection?(): Promise<ConnectionReport>;
}

// A terminal job state, as reported by the provider.
export interface JobOutcome {
  providerJobId: string;
  kind: "completed" | "failed";
  eventType: string;
  errorCode?: string;
  // Readable explanation for a failure; never an upstream body.
  detail?: string;
  costUsd?: number;
  outputUrl?: string;
  // The video already shows the script's captions, drawn into the picture.
  captions?: "burned";
}

export interface PromptLine {
  role: LineRole;
  text: string;
  emotion: Emotion;
}

// Script lines + emotion tags + the actor's voice profile compile into the
// provider's native-audio dialogue prompt (no separate TTS vendor).
export function compilePrompt(input: { lines: PromptLine[]; voiceProfile: string; language: string }): string {
  const dialogue = input.lines.map((l) => `[${l.emotion}] (${l.role}) ${l.text}`).join("\n");
  return [
    `UGC-style ad, single actor speaking to camera.`,
    `Voice: ${input.voiceProfile}. Language: ${input.language}.`,
    `Dialogue:`,
    dialogue,
  ].join("\n");
}
