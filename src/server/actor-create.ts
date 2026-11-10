import { and, eq } from "drizzle-orm";
import { generateImages } from "llm-connect/image";

import { actorAssets, actors, ASSET_SET, customPicturePath, listActors, type ListedActor } from "~/modules/actors";
import { estimateMediaUsd, type MediaModel } from "~/modules/models";
import { projects } from "~/modules/studio";
import type { Db } from "~/server/db/types";
import { removeActorPictures, storeActorPicture } from "~/server/actor-pictures";
import { sniffMedia } from "~/server/media-sniff";
import { dataUrl, type PictureBytes } from "~/server/picture-framing";
import { MEDIA_TIMEOUT_MS } from "~/server/shot-media-core";

// An actor made in the studio from a description, with a photo model on the
// user's own key: a front portrait drawn from the description, then the five
// other pictures of the set (two side views, three expressions) drawn from
// that portrait, so the face, hair and clothes stay the same. The pictures
// are kept in the media storage; the actor belongs to the workspace.

// The photo model a first actor is made with when none is chosen: cheap
// (about a cent a picture on OpenRouter) and faithful to a reference.
export const DEFAULT_ACTOR_PHOTO_MODEL = {
  provider: "openrouter",
  id: "black-forest-labs/flux-3-image-klein",
} as const;

export const ACTOR_PICTURE_COUNT = ASSET_SET.length;

export class ActorCreateError extends Error {}

export interface ActorDescription {
  name: string;
  gender: "female" | "male" | "nonbinary";
  ageRange: string;
  style: string;
  // What they look like: face, hair, skin, build, clothes.
  look: string;
  // How they speak, for the models that voice them.
  voiceProfile: string;
}

// Only a provider that takes a reference picture can draw the same person
// again; OpenRouter's Image API does (input_references).
export function drawsFromReference(model: Pick<MediaModel, "provider">): boolean {
  return model.provider === "openrouter";
}

const GENDER_WORD = { female: "woman", male: "man", nonbinary: "person" } as const;

export function frontPrompt(d: ActorDescription): string {
  return [
    `Photorealistic head-and-shoulders portrait photo of a fictional ${GENDER_WORD[d.gender]} (not a real or famous person), aged ${d.ageRange}, ${d.style} style.`,
    d.look.trim(),
    "Looking straight at the camera with a relaxed, neutral expression. Soft even daylight, plain light grey studio background, natural skin texture, sharp focus, no text, no watermark.",
  ]
    .filter(Boolean)
    .join(" ");
}

// The five other pictures of the set, by file stem, as the change from the front.
const VARIANT: Record<string, string> = {
  "profile-left": "head and shoulders turned to their left, seen in three-quarter profile, neutral expression",
  "profile-right": "head and shoulders turned to their right, seen in three-quarter profile, neutral expression",
  happy: "facing the camera and smiling warmly, happy",
  calm: "facing the camera with a calm, gentle closed-mouth smile, relaxed",
  excited: "facing the camera, excited and enthusiastic, eyebrows raised, open-mouthed smile",
};

export function variantPrompt(stem: string): string {
  return `The same person as in the reference photo: same face, hair, skin, age, clothes and plain light grey studio background. Now ${VARIANT[stem]}. Photorealistic head-and-shoulders portrait, same lighting, no text.`;
}

export type DrawImages = typeof generateImages;

async function draw(
  model: MediaModel,
  apiKey: string,
  prompt: string,
  reference: PictureBytes | null,
  drawImages: DrawImages,
): Promise<{ picture: PictureBytes; ext: string; costUsd: number | null }> {
  const result = await drawImages(
    { provider: model.provider as "openrouter", apiKey, model: model.modelId },
    {
      prompt,
      aspectRatio: "3:4",
      n: 1,
      ...(reference
        ? {
            providerOptions: {
              openrouter: { input_references: [{ type: "image_url", image_url: { url: dataUrl(reference) } }] },
            },
          }
        : {}),
    },
    { abortSignal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) },
  );
  const first = result.images[0];
  if (!first) throw new ActorCreateError("The photo model finished without returning a picture.");
  const kind = sniffMedia(first.data, "image");
  if (!kind) throw new ActorCreateError("The photo model returned no readable picture.");
  return { picture: { data: first.data, mediaType: kind.mime }, ext: kind.ext, costUsd: result.costUsd ?? null };
}

export interface CreatedActor {
  actor: ListedActor;
  // What the provider reported, else the model's list price for the set.
  costUsd: number | null;
}

// Make the actor: refused before any paid call when the model cannot draw
// from a reference; on any failure after that, nothing is kept.
export async function createActor(
  db: Db,
  input: { workspaceId: string; description: ActorDescription; model: MediaModel; apiKey: string },
  drawImages: DrawImages = generateImages,
): Promise<CreatedActor> {
  const { description: d, model } = input;
  if (model.medium !== "image") throw new ActorCreateError(`${model.label} is not a photo model.`);
  if (!drawsFromReference(model))
    throw new ActorCreateError(
      `${model.label} cannot draw the same person twice. Make actors with a photo model on OpenRouter, which takes a reference picture.`,
    );

  const [row] = await db
    .insert(actors)
    .values({
      workspaceId: input.workspaceId,
      name: d.name.trim(),
      gender: d.gender,
      ageRange: d.ageRange.trim(),
      style: d.style.trim(),
      voiceProfile: d.voiceProfile.trim(),
      kind: "custom",
      assetVersion: 1,
    })
    .returning({ id: actors.id });
  const actorId = row!.id;
  const stored: string[] = [];
  try {
    const front = await draw(model, input.apiKey, frontPrompt(d), null, drawImages);
    const variants = await Promise.all(
      ASSET_SET.slice(1).map((asset) =>
        draw(model, input.apiKey, variantPrompt(asset.file.replace(/\.[^.]+$/, "")), front.picture, drawImages),
      ),
    );
    const drawn = [front, ...variants];
    const rows = [];
    for (const [i, asset] of ASSET_SET.entries()) {
      const { picture, ext } = drawn[i]!;
      const path = customPicturePath(actorId, 1, `${asset.file.replace(/\.[^.]+$/, "")}.${ext}`);
      await storeActorPicture(path, picture);
      stored.push(path);
      rows.push({ actorId, kind: asset.kind, emotion: asset.emotion, storagePath: path, version: 1 });
    }
    await db.insert(actorAssets).values(rows);
    const reported = drawn.map((p) => p.costUsd);
    const costUsd = reported.every((c) => c !== null)
      ? Math.round(reported.reduce((a, c) => a + c!, 0) * 1000) / 1000
      : estimateMediaUsd(model, { images: ACTOR_PICTURE_COUNT });
    const actor = (await listActors(db, {}, { workspaceId: input.workspaceId })).find((a) => a.id === actorId)!;
    return { actor, costUsd };
  } catch (error) {
    await db.delete(actors).where(eq(actors.id, actorId));
    await removeActorPictures(stored);
    if (error instanceof ActorCreateError) throw error;
    const code = (error as { code?: string }).code;
    throw new ActorCreateError(
      code === "auth"
        ? "The provider refused the key. Check it in Settings."
        : `The photo model could not draw the actor: ${error instanceof Error && error.message ? error.message.slice(0, 300) : "unknown error"}`,
    );
  }
}

export class ActorInUseError extends Error {}

// Delete an actor made in this workspace, with its pictures. One a project
// still casts is refused; renders already made keep their video.
export async function deleteCustomActor(db: Db, workspaceId: string, actorId: string): Promise<boolean> {
  const [actor] = await db
    .select({ id: actors.id, name: actors.name })
    .from(actors)
    .where(and(eq(actors.id, actorId), eq(actors.workspaceId, workspaceId), eq(actors.kind, "custom")))
    .limit(1);
  if (!actor) return false;
  const using = await db
    .select({ title: projects.title, kind: projects.kind })
    .from(projects)
    .where(and(eq(projects.actorId, actorId), eq(projects.workspaceId, workspaceId)));
  const named = using.filter((p) => p.kind !== "shots");
  if (named.length)
    throw new ActorInUseError(
      `${actor.name} is cast in ${named.map((p) => `"${p.title}"`).join(", ")}. Cast someone else there first.`,
    );
  const pictures = await db
    .select({ storagePath: actorAssets.storagePath })
    .from(actorAssets)
    .where(eq(actorAssets.actorId, actorId));
  await db.delete(actors).where(eq(actors.id, actorId));
  await removeActorPictures(pictures.map((p) => p.storagePath));
  return true;
}
