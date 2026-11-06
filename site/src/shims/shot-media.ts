import type * as Real from "~/server/shot-media";

// Stands in for src/server/shot-media.ts in the browser edition. Photos and
// voice clips render on cloud models with the visitor's own keys, which only
// the self-hosted studio keeps, so nothing here ever runs a provider (the
// Shots page says so before any launch).

const NEEDS_SELF_HOSTED = "Photos and voice clips render on the self-hosted studio only, with your own API keys.";

export const MEDIA_TIMEOUT_MS = 180_000;

export type MediaShotInput = Real.MediaShotInput;
export type MediaRenderer = Real.MediaRenderer;

export function sniffMedia(): null {
  return null;
}

export function imageSize(): null {
  return null;
}

export async function renderMediaShot(): Promise<never> {
  throw new Error(NEEDS_SELF_HOSTED);
}

// Fails the typecheck when the real module's exports change shape.
({ MEDIA_TIMEOUT_MS, sniffMedia, imageSize, renderMediaShot }) satisfies typeof Real;
