import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Image, loadImage } from "@napi-rs/canvas";

import type { PortraitShot, ScenePortraits } from "../../src/modules/scene";

// The actors' pictures: the folder laid out like Troupe's storage paths
// (actors/<slug>/v<version>/<file>), without the leading actors/. By default
// the cast checked in with the app; PORTRAITS_DIR points elsewhere.
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_PORTRAITS_DIR = join(REPO_ROOT, "public", "actors");

// PORTRAITS_DIR as a folder: a relative path is read from the repository
// root, since `pnpm renderer` runs from renderer/.
export function portraitsDir(value: string | undefined): string {
  return value?.trim() ? resolve(REPO_ROOT, value.trim()) : DEFAULT_PORTRAITS_DIR;
}

// Decodes the `shots` a scene shows from the job's portrait paths (already
// checked by parseJobBody). A missing or unreadable picture is left out: the
// card falls back to the front portrait, then to the initials.
export async function loadPortraits(
  dir: string,
  paths: Record<string, string> | undefined,
  shots: PortraitShot[],
  log: (message: string) => void = () => {},
): Promise<ScenePortraits<Image>> {
  const portraits: ScenePortraits<Image> = {};
  for (const shot of shots) {
    const path = paths?.[shot];
    if (!path) continue;
    const file = join(dir, path.replace(/^actors\//, ""));
    try {
      portraits[shot] = await loadImage(await readFile(file));
    } catch (error) {
      log(`No ${shot} portrait at ${file}: ${(error as Error).message}`);
    }
  }
  return portraits;
}
