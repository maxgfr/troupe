// The 30-actor library — the checked-in source of truth the
// seeder loads. Each actor's pictures are synthetic people generated with
// FLUX.2 [klein] 4B by scripts/actors/generate.py, checked in at
// public/actors/<slug>/v1/ (the storage paths below, under public/); the DB
// only tracks the versioned set.
export interface CatalogActor {
  slug: string;
  name: string;
  gender: "female" | "male" | "nonbinary";
  ageRange: string;
  style: string;
  voiceProfile: string;
}

const FIRST: [string, CatalogActor["gender"]][] = [
  ["Léa", "female"],
  ["Marcus", "male"],
  ["Aiko", "female"],
  ["Diego", "male"],
  ["Nora", "female"],
  ["Ethan", "male"],
  ["Priya", "female"],
  ["Jonas", "male"],
  ["Zoé", "female"],
  ["Malik", "male"],
  ["Ines", "female"],
  ["Viktor", "male"],
  ["Sam", "nonbinary"],
  ["Chloé", "female"],
  ["Andre", "male"],
  ["Yuki", "female"],
  ["Owen", "male"],
  ["Fatou", "female"],
  ["Luca", "male"],
  ["Maya", "female"],
  ["Ravi", "male"],
  ["Elsa", "female"],
  ["Tom", "male"],
  ["Nadia", "female"],
  ["Kai", "nonbinary"],
  ["Sofia", "female"],
  ["Hugo", "male"],
  ["Amara", "female"],
  ["Louis", "male"],
  ["Emma", "female"],
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

export const ACTOR_CATALOG: CatalogActor[] = FIRST.map(([name, gender], i) => ({
  slug: `${name.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}-${String(i + 1).padStart(2, "0")}`,
  name,
  gender,
  ageRange: AGES[i % AGES.length]!,
  style: STYLES[i % STYLES.length]!,
  voiceProfile: VOICES[i % VOICES.length]!,
}));

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

export function storagePathFor(slug: string, version: number, file: string): string {
  return `actors/${slug}/v${version}/${file}`;
}
