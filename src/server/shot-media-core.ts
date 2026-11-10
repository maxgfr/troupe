import { eq } from "drizzle-orm";
import { generateImages, type ImageProviderId } from "llm-connect/image";
import { generateSpeechAudio, type SpeechProviderId } from "llm-connect/speech";

import { generations, mediaAssets } from "~/modules/generation";
import type { MediaModel } from "~/modules/models";
import { projects } from "~/modules/studio";
import type { Db } from "~/server/db/types";
import { imageSize, sniffMedia } from "~/server/media-sniff";

// Photos and voice clips from the Shots page: one provider call each, made
// while the launch waits (seconds, not minutes), the result stored like a
// video render so the gallery, downloads and deletion treat them alike. Where
// the file is kept is each edition's own (KeepShotFile): the studio's disk or
// Supabase (shot-media.ts), the browser's IndexedDB (site/src/shims). No Node
// built-ins here.

export const MEDIA_TIMEOUT_MS = 180_000;
const MAX_BYTES = 40 * 1024 * 1024;

// Keeps a shot's file under its asset id; says where, and how long a voice
// clip lasts when it can tell.
export type KeepShotFile = (file: {
  assetId: string;
  storagePath: string;
  bytes: Uint8Array;
  mime: string;
  ext: string;
  medium: "image" | "speech";
}) => Promise<{ storage: string; durationS: number | null }>;

export interface MediaShotInput {
  projectId: string;
  model: MediaModel;
  apiKey: string;
  // The text to draw, or to say.
  text: string;
  image?: { aspectRatio: string; size?: string };
  speech?: { voice?: string; instructions?: string; language?: string };
  estimatedCostUsd: number | null;
  actorId?: string | null;
  // The actor's picture (a data URL), drawn from by the photo models that
  // take a reference (OpenRouter's); the others go by the description.
  referencePicture?: string | null;
  parentGenerationId?: string;
}

export type MediaRenderer = {
  image: typeof generateImages;
  speech: typeof generateSpeechAudio;
};
export const mediaProviders: MediaRenderer = { image: generateImages, speech: generateSpeechAudio };

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Render one photo or voice clip and keep it. The row is saved first (as a
// running shot), then completed with the file, or failed with a readable
// reason: a provider's refusal never throws past here.
export async function renderMediaShotWith(
  db: Db,
  input: MediaShotInput,
  keep: KeepShotFile,
  renderers: MediaRenderer = mediaProviders,
) {
  const { model } = input;
  const [gen] = await db
    .insert(generations)
    .values({
      projectId: input.projectId,
      modelKey: model.key,
      provider: model.provider,
      modelId: model.modelId,
      medium: model.medium,
      inputMode: "text",
      tier: "draft",
      actorId: input.actorId ?? null,
      prompt: input.text,
      aspectRatio: input.image?.aspectRatio ?? "",
      durationS: 0,
      resolution: input.image?.size ?? "",
      options: input.image ? { ...input.image } : { ...input.speech },
      status: "in_progress",
      costUsd: input.estimatedCostUsd === null ? null : String(input.estimatedCostUsd),
      costSource: input.estimatedCostUsd === null ? null : "estimate",
      parentGenerationId: input.parentGenerationId ?? null,
    })
    .returning();
  const fail = async (code: string, detail: string) => {
    const [row] = await db
      .update(generations)
      .set({ status: "failed", errorCode: code, errorDetail: detail.slice(0, 300), completedAt: new Date() })
      .where(eq(generations.id, gen!.id))
      .returning();
    return row!;
  };

  let bytes: Uint8Array;
  let reportedCost: number | undefined;
  try {
    const signal = AbortSignal.timeout(MEDIA_TIMEOUT_MS);
    if (model.medium === "image") {
      const result = await renderers.image(
        { provider: model.provider as ImageProviderId, apiKey: input.apiKey, model: model.modelId },
        {
          prompt: input.text,
          aspectRatio: input.image?.aspectRatio,
          size: input.image?.size,
          n: 1,
          ...(input.referencePicture && model.provider === "openrouter"
            ? {
                providerOptions: {
                  openrouter: {
                    input_references: [{ type: "image_url", image_url: { url: input.referencePicture } }],
                  },
                },
              }
            : {}),
        },
        { abortSignal: signal },
      );
      const first = result.images[0];
      if (!first) return fail("NO_IMAGE_RETURNED", "The provider finished without returning an image.");
      bytes = first.data;
      reportedCost = result.costUsd;
    } else {
      const result = await renderers.speech(
        { provider: model.provider as SpeechProviderId, apiKey: input.apiKey, model: model.modelId },
        {
          text: input.text,
          ...(input.speech?.voice ? { voice: input.speech.voice } : {}),
          ...(input.speech?.instructions && model.instructions ? { instructions: input.speech.instructions } : {}),
          ...(input.speech?.language ? { language: input.speech.language } : {}),
        },
        { abortSignal: signal },
      );
      bytes = result.audio.data;
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    return fail(
      code === "auth" ? "PROVIDER_AUTH" : code === "rate-limit" ? "PROVIDER_QUOTA" : "PROVIDER_FAILED",
      error instanceof Error && error.message ? error.message : "The provider could not render it.",
    );
  }

  if (bytes.length > MAX_BYTES) return fail("FILE_TOO_LARGE", "The provider returned a file over 40 MB.");
  const kind = sniffMedia(bytes, model.medium);
  if (!kind)
    return fail(
      "INVALID_FILE",
      model.medium === "image"
        ? "The provider returned no readable image."
        : "The provider returned no readable audio.",
    );

  const assetId = crypto.randomUUID();
  const storagePath = `renders/${input.projectId}/${gen!.id}.${kind.ext}`;
  const kept = await keep({ assetId, storagePath, bytes, mime: kind.mime, ext: kind.ext, medium: model.medium });

  const [project] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  const size = model.medium === "image" ? imageSize(bytes) : null;
  const [asset] = await db
    .insert(mediaAssets)
    .values({
      id: assetId,
      workspaceId: project!.workspaceId,
      kind: "render",
      storagePath,
      mimeType: kind.mime,
      bytes: bytes.length,
      checksum: await sha256Hex(bytes),
      meta: {
        storage: kept.storage,
        ...(size ?? {}),
        ...(kept.durationS ? { durationS: kept.durationS } : {}),
      },
    })
    .returning();
  const [done] = await db
    .update(generations)
    .set({
      status: "completed",
      outputAssetId: asset!.id,
      completedAt: new Date(),
      ...(reportedCost != null ? { costUsd: String(reportedCost), costSource: "provider" as const } : {}),
    })
    .where(eq(generations.id, gen!.id))
    .returning();
  return done!;
}
