import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { GlobalFonts } from "@napi-rs/canvas";

import { SCENE_FONT } from "../../src/modules/scene";

const require = createRequire(import.meta.url);
let registered = false;

// The scene draws in Geist, the app's sans-serif. Containers have no system
// fonts, so the renderer ships its own (latin subset, the weights drawn).
// `file` (SCENE_FONT_FILE: a .ttf, .otf, .woff or .woff2) replaces it; a
// variable font covers every weight drawn, a static one is used for all.
export function registerSceneFonts(file?: string): void {
  if (registered) return;
  if (file) {
    if (!existsSync(file) || !GlobalFonts.registerFromPath(file, SCENE_FONT))
      throw new Error(`SCENE_FONT_FILE: no font could be read from ${file}.`);
  } else {
    for (const weight of [500, 600, 700]) {
      GlobalFonts.registerFromPath(
        require.resolve(`@fontsource/geist-sans/files/geist-sans-latin-${weight}-normal.woff2`),
        SCENE_FONT,
      );
    }
  }
  registered = true;
}
