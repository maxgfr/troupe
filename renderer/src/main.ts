// Troupe's local renderer: voices a script with Kokoro, draws the actor card
// and karaoke captions, and encodes an MP4 with ffmpeg. It speaks the HTTP
// contract v1, so Troupe adds it in Settings like any HTTP model
// (docs/LOCAL-MODELS.md).
//
//   pnpm renderer                       # http://127.0.0.1:8078
//   PORT=8078 HOST=0.0.0.0 TOKEN=secret pnpm renderer
//
// Requires ffmpeg on the PATH.
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { registerSceneFonts } from "./fonts";
import { type KokoroDtype, kokoroVoice } from "./kokoro";
import { createRendererServer } from "./server";

const PORT = Number(process.env.PORT ?? 8078);
const HOST = process.env.HOST ?? "127.0.0.1";
const log = (message: string) => console.log(`[renderer] ${message}`);

registerSceneFonts();
const kokoro = kokoroVoice({
  cacheDir: process.env.KOKORO_CACHE ?? join(homedir(), ".cache", "troupe-renderer"),
  dtype: (process.env.KOKORO_DTYPE as KokoroDtype | undefined) ?? "q8",
  log,
});
const server = createRendererServer({
  speak: kokoro.speak,
  outDir: process.env.OUT_DIR ?? join(tmpdir(), "troupe-renderer"),
  token: process.env.TOKEN || undefined,
  log,
});

// PORT=0 picks a free port: print the one actually bound.
server.listen(PORT, HOST, () => {
  const address = server.address();
  log(`Troupe renderer on http://${HOST}:${typeof address === "object" && address ? address.port : PORT} (contract v1)`);
  // Fetch the voices now so the first render does not wait for the download.
  log("Loading the Kokoro voices (downloaded once, about 90 MB)…");
  kokoro.load().catch((error: Error) => log(error.message));
});
