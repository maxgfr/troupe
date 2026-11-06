import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { eq } from "drizzle-orm";
import { generateImages, type ImageProviderId } from "llm-connect/image";
import { generateSpeechAudio, type SpeechProviderId } from "llm-connect/speech";

import { generations, mediaAssets } from "~/modules/generation";
import type { MediaModel } from "~/modules/models";
import { projects } from "~/modules/studio";
import type { Db } from "~/server/db/types";
import { ffprobePath, mediaFilePath } from "~/server/media/storage";
import { uploadToSupabase } from "~/server/media/supabase";

const run = promisify(execFile);

// Photos and voice clips from the Shots page: one provider call each, made
// while the launch waits (seconds, not minutes), the result stored like a
// video render so the gallery, downloads and deletion treat them alike.

export const MEDIA_TIMEOUT_MS = 180_000;
const MAX_BYTES = 40 * 1024 * 1024;

// The kinds of file a provider may send back, by their first bytes.
const SIGNATURES: { mime: string; ext: string; test: (b: Uint8Array) => boolean }[] = [
  { mime: "image/png", ext: "png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", ext: "webp", test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP" },
  { mime: "audio/wav", ext: "wav", test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE" },
  { mime: "audio/ogg", ext: "ogg", test: (b) => ascii(b, 0, 4) === "OggS" },
  { mime: "audio/flac", ext: "flac", test: (b) => ascii(b, 0, 4) === "fLaC" },
  { mime: "audio/mp4", ext: "m4a", test: (b) => ascii(b, 4, 8) === "ftyp" },
  {
    mime: "audio/mpeg",
    ext: "mp3",
    test: (b) => ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0),
  },
];

function ascii(b: Uint8Array, from: number, to: number) {
  return String.fromCharCode(...b.subarray(from, to));
}

// The file's real type from its bytes, never from what the provider said.
export function sniffMedia(bytes: Uint8Array, medium: "image" | "speech") {
  const found = SIGNATURES.find((s) => s.test(bytes));
  if (!found || (medium === "image") !== found.mime.startsWith("image/")) return null;
  return found;
}

// A PNG's, JPEG's or WebP's size in pixels, read from its header.
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 24 && bytes[0] === 0x89) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length > 30 && ascii(bytes, 8, 12) === "WEBP") {
    const chunk = ascii(bytes, 12, 16);
    if (chunk === "VP8X")
      return { width: 1 + (view.getUint32(24, true) & 0xffffff), height: 1 + (view.getUint32(27, true) & 0xffffff) };
    if (chunk === "VP8 ")
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1]!;
      const length = view.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
      i += 2 + length;
    }
  }
  return null;
}

async function audioDurationS(path: string): Promise<number | null> {
  try {
    const { stdout } = await run(
      ffprobePath(),
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", path],
      {
        timeout: 15_000,
      },
    );
    const value = Number((JSON.parse(stdout) as { format?: { duration?: string } }).format?.duration);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

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
  parentGenerationId?: string;
}

export type MediaRenderer = {
  image: typeof generateImages;
  speech: typeof generateSpeechAudio;
};
const providers: MediaRenderer = { image: generateImages, speech: generateSpeechAudio };

// Render one photo or voice clip and keep it. The row is saved first (as a
// running shot), then completed with the file, or failed with a readable
// reason: a provider's refusal never throws past here.
export async function renderMediaShot(db: Db, input: MediaShotInput, renderers: MediaRenderer = providers) {
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
        { prompt: input.text, aspectRatio: input.image?.aspectRatio, size: input.image?.size, n: 1 },
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

  const storagePath = `renders/${input.projectId}/${gen!.id}.${kind.ext}`;
  const remote = await uploadToSupabase(storagePath, bytes);
  let durationS: number | null = null;
  const scratch = await mkdtemp(join(tmpdir(), "troupe-shot-"));
  try {
    const temporary = join(scratch, `file.${kind.ext}`);
    await writeFile(temporary, bytes, { mode: 0o600 });
    if (model.medium === "speech") durationS = await audioDurationS(temporary);
    if (!remote) {
      if (process.env.VERCEL) throw new Error("Supabase storage must be configured on Vercel.");
      const destination = mediaFilePath(storagePath);
      await mkdir(dirname(destination), { recursive: true });
      await rename(temporary, destination).catch(async () => {
        await writeFile(destination, bytes, { mode: 0o600 });
      });
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  const [project] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  const size = model.medium === "image" ? imageSize(bytes) : null;
  const [asset] = await db
    .insert(mediaAssets)
    .values({
      workspaceId: project!.workspaceId,
      kind: "render",
      storagePath,
      mimeType: kind.mime,
      bytes: bytes.length,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      meta: {
        storage: remote ? "supabase" : "local",
        ...(size ?? {}),
        ...(durationS ? { durationS } : {}),
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
