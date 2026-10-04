import type { Emotion } from "~/modules/script";

// Kokoro (kokoro-js, Kokoro-82M v1.0) voices for an actor. Both renderers
// call this, so an actor sounds the same in the browser and on the server.
// Only voices graded C or better by Kokoro's authors are used.
export const KOKORO_VOICES = {
  female: ["af_heart", "af_bella", "af_nicole", "bf_emma", "af_aoede", "af_kore", "af_sarah"],
  male: ["am_michael", "am_fenrir", "am_puck", "bm_george", "bm_fable"],
} as const;

export interface VoiceActor {
  id: string;
  gender?: "female" | "male" | "nonbinary";
  // Free-text delivery, e.g. "bright and fast, upbeat".
  voiceProfile?: string;
}

export interface VoiceChoice {
  voice: string;
  speed: number;
}

const EMOTION_SPEED: Record<Emotion, number> = {
  neutral: 1,
  excited: 1.12,
  happy: 1.06,
  serious: 0.95,
  calm: 0.92,
  disappointed: 0.88,
};

function tempo(profile = ""): number {
  if (/\b(fast|upbeat|quick)/i.test(profile)) return 1.06;
  if (/\b(slow|measured|soft-spoken|low register)/i.test(profile)) return 0.95;
  return 1;
}

function stableIndex(id: string, modulo: number): number {
  let h = 0;
  for (const c of id) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return h % modulo;
}

export function voiceFor(actor: VoiceActor, emotion: Emotion): VoiceChoice {
  const pool: readonly string[] =
    actor.gender === "female" ? KOKORO_VOICES.female : actor.gender === "male" ? KOKORO_VOICES.male : [...KOKORO_VOICES.female, ...KOKORO_VOICES.male];
  const speed = Math.round(EMOTION_SPEED[emotion] * tempo(actor.voiceProfile) * 100) / 100;
  return { voice: pool[stableIndex(actor.id, pool.length)]!, speed };
}
