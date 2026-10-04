import { createRequire } from "node:module";
import { GlobalFonts } from "@napi-rs/canvas";

import { SCENE_FONT } from "../../src/modules/scene";

const require = createRequire(import.meta.url);
let registered = false;

// The scene draws in Geist, the app's sans-serif. Containers have no system
// fonts, so the renderer ships its own (latin subset, the weights drawn).
export function registerSceneFonts(): void {
  if (registered) return;
  for (const weight of [500, 600, 700]) {
    GlobalFonts.registerFromPath(require.resolve(`@fontsource/geist-sans/files/geist-sans-latin-${weight}-normal.woff2`), SCENE_FONT);
  }
  registered = true;
}
