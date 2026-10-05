import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Image, loadImage } from "@napi-rs/canvas";

import type { PortraitShot, ScenePortraits } from "../../src/modules/scene";

// The actors' pictures: the folder laid out like Troupe's storage paths
// (actors/<slug>/v<version>/<file>), without the leading actors/. By default
// the cast checked in with the app; PORTRAITS_DIR points elsewhere.
export const DEFAULT_PORTRAITS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "actors");

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
