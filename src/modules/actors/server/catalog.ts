// The 30-actor library — the checked-in source of truth the
// seeder loads. Each actor's pictures are synthetic people generated with
// FLUX.2 [klein] 4B by scripts/actors/generate.py, checked in at
// public/actors/<slug>/v1/ (the storage paths below, under public/); the DB
// only tracks the versioned set. Beside them, a short sample of the actor's
// voice (VOICE_SAMPLE_FILES, scripts/actors/voices.ts).
export interface CatalogActor {
  slug: string;
  name: string;
  gender: "female" | "male" | "nonbinary";
  ageRange: string;
  style: string;
  voiceProfile: string;
  // The Kokoro voice the renderers read their lines with (src/modules/scene
  // voiceFor), the one their sample plays. Every voice of the default pools
  // is used, by two or three actors at most.
  voice: string;
}

const FIRST: [string, CatalogActor["gender"], string][] = [
  ["Léa", "female", "af_heart"],
  ["Marcus", "male", "am_michael"],
  ["Aiko", "female", "af_bella"],
  ["Diego", "male", "am_fenrir"],
  ["Nora", "female", "af_nicole"],
  ["Ethan", "male", "am_puck"],
  ["Priya", "female", "bf_emma"],
  ["Jonas", "male", "bm_george"],
  ["Zoé", "female", "af_aoede"],
  ["Malik", "male", "bm_fable"],
  ["Ines", "female", "af_kore"],
  ["Viktor", "male", "am_michael"],
  ["Sam", "nonbinary", "af_sarah"],
  ["Chloé", "female", "af_heart"],
  ["Andre", "male", "am_fenrir"],
  ["Yuki", "female", "af_bella"],
  ["Owen", "male", "am_puck"],
  ["Fatou", "female", "af_nicole"],
  ["Luca", "male", "bm_george"],
  ["Maya", "female", "bf_emma"],
  ["Ravi", "male", "bm_fable"],
  ["Elsa", "female", "af_aoede"],
  ["Tom", "male", "am_michael"],
  ["Nadia", "female", "af_kore"],
  ["Kai", "nonbinary", "am_puck"],
  ["Sofia", "female", "af_sarah"],
  ["Hugo", "male", "am_fenrir"],
  ["Amara", "female", "af_heart"],
  ["Louis", "male", "bm_george"],
  ["Emma", "female", "bf_emma"],
];
const AGES = ["18-24", "25-34", "35-44", "45-54", "55+"];
const STYLES = ["casual", "formal", "sporty", "streetwear", "creative", "cozy"];
const VOICES = [
  "warm and enthusiastic, mid-tempo",
  "calm and confident, low register",
  "bright and fast, upbeat",
  "measured and trustworthy",
  "playful with rising intonation",
  "soft-spoken and intimate",
];

export const ACTOR_CATALOG: CatalogActor[] = FIRST.map(([name, gender, voice], i) => ({
  slug: `${name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z]/g, "")}-${String(i + 1).padStart(2, "0")}`,
  name,
  gender,
  ageRange: AGES[i % AGES.length]!,
  style: STYLES[i % STYLES.length]!,
  voiceProfile: VOICES[i % VOICES.length]!,
  voice,
}));

// A library actor's voice, found the way the seed finds them in the
// database (name and age range); undefined for anyone else.
export function libraryVoice(actor: { name: string; ageRange: string }): string | undefined {
  return ACTOR_CATALOG.find((c) => c.name === actor.name && c.ageRange === actor.ageRange)?.voice;
}

export interface CatalogAsset {
  kind: "portrait" | "angle" | "emotion";
  emotion?: string;
  file: string;
}

// 6 assets per actor: front portrait, two side views, three emotions.
export const ASSET_SET: CatalogAsset[] = [
  { kind: "portrait", file: "front.webp" },
  { kind: "angle", file: "profile-left.webp" },
  { kind: "angle", file: "profile-right.webp" },
  { kind: "emotion", emotion: "happy", file: "happy.webp" },
  { kind: "emotion", emotion: "calm", file: "calm.webp" },
  { kind: "emotion", emotion: "excited", file: "excited.webp" },
];

// The actor's voice sample, in the two encodings browsers need: Opus in
// WebM, and AAC for those without it (src/modules/actors/pictures.ts).
export const VOICE_SAMPLE_FILES = ["voice.webm", "voice.m4a"] as const;

export function storagePathFor(slug: string, version: number, file: string): string {
  return `actors/${slug}/v${version}/${file}`;
}
