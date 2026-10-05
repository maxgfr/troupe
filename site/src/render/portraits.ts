import type { PortraitShot, ScenePortraits } from "~/modules/scene";

// The actor's pictures for the browser renderer: the site serves the cast at
// <base>actors/<slug>/v<version>/<file> (site/vite-plugins.ts, actorPortraits),
// the same paths Troupe stores. A picture that does not load is left out:
// the card falls back to the front portrait, then to the initials.
export async function loadPortraits(paths: Record<string, string> | undefined, shots: PortraitShot[], base: string): Promise<ScenePortraits<ImageBitmap>> {
  const portraits: ScenePortraits<ImageBitmap> = {};
  await Promise.all(
    shots.map(async (shot) => {
      const path = paths?.[shot];
      if (!path) return;
      try {
        const response = await fetch(`${base}${path}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        portraits[shot] = await createImageBitmap(await response.blob());
      } catch (error) {
        console.warn(`The ${shot} portrait (${path}) did not load:`, error);
      }
    }),
  );
  return portraits;
}
