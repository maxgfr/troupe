import type { Emotion } from "~/modules/script";

// Kokoro (kokoro-js, Kokoro-82M v1.0) voices for an actor. Both renderers
// call this, so an actor sounds the same in the browser and on the server.
// Only voices graded C or better by Kokoro's authors are used.
export interface VoicePools {
  female: readonly string[];
  male: readonly string[];
}

export const KOKORO_VOICES: VoicePools = {
  female: ["af_heart", "af_bella", "af_nicole", "bf_emma", "af_aoede", "af_kore", "af_sarah"],
  male: ["am_michael", "am_fenrir", "am_puck", "bm_george", "bm_fable"],
};

// A voice map from configuration: "female=af_heart,af_bella;male=am_michael".
// Both pools are required; names are Kokoro voice ids.
export function parseVoicePools(text: string): VoicePools {
  const pools: Partial<Record<keyof VoicePools, string[]>> = {};
  for (const part of text
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const [key = "", list = ""] = part.split("=", 2).map((s) => s.trim());
    if (key !== "female" && key !== "male") throw new Error(`"${key}" is not a pool: use female=… and male=….`);
    const names = list
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    const bad = names.find((n) => !/^[a-z]{2}_[a-z0-9]+$/.test(n));
    if (bad) throw new Error(`"${bad}" is not a Kokoro voice id such as af_heart.`);
    pools[key] = names;
  }
  for (const key of ["female", "male"] as const) {
    if (!pools[key]?.length)
      throw new Error(`the ${key} pool needs at least one voice (e.g. ${key}=${KOKORO_VOICES[key][0]}).`);
  }
  return { female: pools.female!, male: pools.male! };
}

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

export function voiceFor(actor: VoiceActor, emotion: Emotion, voices: VoicePools = KOKORO_VOICES): VoiceChoice {
  const pool: readonly string[] =
    actor.gender === "female"
      ? voices.female
      : actor.gender === "male"
        ? voices.male
        : [...voices.female, ...voices.male];
  const speed = Math.round(EMOTION_SPEED[emotion] * tempo(actor.voiceProfile) * 100) / 100;
  return { voice: pool[stableIndex(actor.id, pool.length)]!, speed };
}
