import type { CredentialId } from "./builtins";
import { CREDENTIAL_NAME, type CredentialSource, type ModelConfigRow, type ModelStatus } from "./resolve";

// The photo and voice models of the Shots page: added from a provider's list
// (llm-models), rendered at once through llm-connect. They live in
// troupe_model_config like the video models, as "image" and "speech" rows,
// but stay out of the video catalog: no clip length, no job to follow.

export type Medium = "image" | "speech";

export const IMAGE_MODEL_PROVIDERS = ["openrouter", "gateway", "fal", "openai", "google", "xai", "replicate"] as const;
export const SPEECH_MODEL_PROVIDERS = ["gateway", "fal", "openai", "google", "elevenlabs"] as const;
export type ImageModelProvider = (typeof IMAGE_MODEL_PROVIDERS)[number];
export type SpeechModelProvider = (typeof SPEECH_MODEL_PROVIDERS)[number];

export interface VoiceOption {
  id: string;
  name: string;
  language?: string;
  gender?: string;
  description?: string;
}

// What an "image" or "speech" row keeps in `connection` (never a secret).
export interface MediaConnection {
  provider: ImageModelProvider | SpeechModelProvider;
  model: string;
  owner?: string;
  // Images: the formats and sizes the provider lists (null: it does not say).
  aspectRatios?: string[] | null;
  sizes?: string[] | null;
  // Voices: the voices and languages it lists, and whether it takes
  // free-text style instructions.
  voices?: VoiceOption[] | null;
  languages?: string[] | null;
  instructions?: boolean | null;
  // Dollars per image, or per million characters spoken.
  price?: { usd: number; per: "image" | "million-characters" } | null;
}

export interface MediaModel {
  key: string;
  medium: Medium;
  label: string;
  vendor: string;
  provider: MediaConnection["provider"];
  credential: CredentialId;
  modelId: string;
  aspectRatios: string[];
  sizes: string[] | null;
  voices: VoiceOption[] | null;
  languages: string[] | null;
  instructions: boolean;
  price: MediaConnection["price"];
  archived: boolean;
  status: ModelStatus;
  statusDetail: string | null;
}

// Formats offered when a provider lists none: the ones image APIs share.
export const DEFAULT_IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"];

export function parseMediaConnection(medium: Medium, connection: unknown): MediaConnection | null {
  const c = connection as Partial<MediaConnection> | null;
  if (!c || typeof c.model !== "string" || !c.model) return null;
  const providers: readonly string[] = medium === "image" ? IMAGE_MODEL_PROVIDERS : SPEECH_MODEL_PROVIDERS;
  if (!providers.includes(String(c.provider))) return null;
  return c as MediaConnection;
}

const ARTICLE: Partial<Record<CredentialId, string>> = { openrouter: "an", openai: "an", xai: "an", elevenlabs: "an" };

function status(source: CredentialSource): ModelStatus {
  if (source === "saved" || source === "environment") return "ready";
  if (source === "undecryptable") return "undecryptable";
  return "missing-credentials";
}

// The photo and voice models of the saved rows, each with its key's status.
export function resolveMediaModels(input: {
  rows: ModelConfigRow[];
  credentials: Partial<Record<CredentialId, CredentialSource>>;
}): MediaModel[] {
  return input.rows
    .filter((r) => r.family === "image" || r.family === "speech")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((r): MediaModel => {
      const medium = r.family as Medium;
      const c = parseMediaConnection(medium, r.connection);
      const credential = (c?.provider ?? "openrouter") as CredentialId;
      const keyStatus = c ? status(input.credentials[credential] ?? "none") : "invalid";
      const name = CREDENTIAL_NAME[credential];
      const owner = c?.owner ?? c?.model.split("/")[0];
      return {
        key: r.id,
        medium,
        label: r.label ?? r.id,
        vendor: owner && owner.toLowerCase() !== credential ? `${owner} via ${name}` : name,
        provider: c?.provider ?? "openrouter",
        credential,
        modelId: c?.model ?? r.id,
        aspectRatios: c?.aspectRatios?.length ? c.aspectRatios : DEFAULT_IMAGE_RATIOS,
        sizes: c?.sizes?.length ? c.sizes : null,
        voices: c?.voices?.length ? c.voices : null,
        languages: c?.languages?.length ? c.languages : null,
        instructions: c?.instructions === true,
        price: c?.price ?? null,
        archived: r.archived,
        status: keyStatus,
        statusDetail: !c
          ? "This model was saved incompletely. Add it again."
          : keyStatus === "missing-credentials"
            ? `Add ${ARTICLE[credential] ?? "a"} ${name} key in Settings.`
            : keyStatus === "undecryptable"
              ? "The saved key can no longer be read. Enter it again."
              : null,
      };
    });
}

// The estimated cost of a launch, or null when the provider lists no price.
export function estimateMediaUsd(model: Pick<MediaModel, "price">, amount: { images?: number; characters?: number }) {
  const price = model.price;
  if (!price) return null;
  const usd =
    price.per === "image" ? price.usd * (amount.images ?? 1) : (price.usd * (amount.characters ?? 0)) / 1_000_000;
  return Math.round(usd * 1000) / 1000;
}
