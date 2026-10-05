// Troupe's local renderer: voices a script with Kokoro, draws the actor card
// and karaoke captions, and encodes an MP4 with ffmpeg. It speaks the HTTP
// contract v1, so Troupe adds it in Settings like any HTTP model
// (docs/LOCAL-MODELS.md).
//
//   pnpm renderer                       # http://127.0.0.1:8078
//   PORT=8078 HOST=0.0.0.0 TOKEN=secret pnpm renderer
//   pnpm renderer:ltx                   # also the AI video mode, at /ltx
//   pnpm renderer:whisper               # also transcription, at /transcribe
//
// Requires ffmpeg on the PATH; the AI video mode also needs uv.
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseVoicePools, type VoicePools } from "../../src/modules/scene";
import { registerSceneFonts } from "./fonts";
import { type KokoroDtype, kokoroVoice, parseKokoroDtype } from "./kokoro";
import { type LtxSettings, ltxReadiness, ltxSettingsFromEnv, stopGenerators } from "./ltx";
import { portraitsDir } from "./portraits";
import { renderLtxVideo } from "./render-ltx";
import { createRendererServer, KEEP_RENDERS_S, LTX_PREFIX } from "./server";
import { transcribeFile, whisperReadiness, type WhisperSettings, whisperSettingsFromEnv } from "./whisper";

const PORT = Number(process.env.PORT ?? 8078);
const HOST = process.env.HOST ?? "127.0.0.1";
const log = (message: string) => console.log(`[renderer] ${message}`);

function refuse(message: string): never {
  console.error(`[renderer] ${message}`);
  process.exit(1);
}

let dtype: KokoroDtype = "q8";
try {
  dtype = parseKokoroDtype(process.env.KOKORO_DTYPE);
} catch (error) {
  refuse((error as Error).message);
}

// KEEP_RENDERS_HOURS: how long finished videos stay on disk (0: forever).
const keepHours = Number(process.env.KEEP_RENDERS_HOURS?.trim() || KEEP_RENDERS_S / 3600);
if (!Number.isFinite(keepHours) || keepHours < 0) refuse(`KEEP_RENDERS_HOURS must be a number of hours, 0 or more (got "${process.env.KEEP_RENDERS_HOURS}").`);

// KOKORO_VOICES="female=af_heart,af_bella;male=am_michael" recasts the actors.
let voices: VoicePools | undefined;
try {
  voices = process.env.KOKORO_VOICES ? parseVoicePools(process.env.KOKORO_VOICES) : undefined;
} catch (error) {
  refuse(`KOKORO_VOICES: ${(error as Error).message}`);
}

// The AI video mode is opt-in: `--ltx` (pnpm renderer:ltx) or LTX_ENABLED=1.
const LTX_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "ltx");
let ltx: LtxSettings | undefined;
if (process.argv.includes("--ltx") || ["1", "true", "yes"].includes(process.env.LTX_ENABLED ?? "")) {
  try {
    ltx = ltxSettingsFromEnv(process.env, ["uv", "run", "--project", LTX_DIR, "python", join(LTX_DIR, "generate.py")]);
  } catch (error) {
    refuse((error as Error).message);
  }
}

// Transcription for the inspiration library is opt-in too: `--whisper`
// (pnpm renderer:whisper) or WHISPER_ENABLED=1.
const WHISPER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "whisper");
let whisper: WhisperSettings | undefined;
if (process.argv.includes("--whisper") || ["1", "true", "yes"].includes(process.env.WHISPER_ENABLED ?? "")) {
  try {
    whisper = whisperSettingsFromEnv(process.env, ["uv", "run", "--project", WHISPER_DIR, "python", join(WHISPER_DIR, "transcribe.py")]);
  } catch (error) {
    refuse((error as Error).message);
  }
}

registerSceneFonts();
const kokoro = kokoroVoice({
  cacheDir: process.env.KOKORO_CACHE ?? join(homedir(), ".cache", "troupe-renderer"),
  dtype,
  log,
});
const server = createRendererServer({
  speak: kokoro.speak,
  voices,
  // PORTRAITS_DIR: another cast, laid out as <actor>/v1/front.webp.
  portraitsDir: portraitsDir(process.env.PORTRAITS_DIR),
  ...(ltx
    ? {
        ltx: {
          render: (request, outFile, onProgress) => renderLtxVideo(request, outFile, { speak: kokoro.speak, voices, settings: ltx, onProgress, log }),
          // A generation takes minutes.
          pollEveryS: 5,
          // The default command runs in renderer/ltx/.venv, made by the setup.
          ready: () => ltxReadiness(ltx.command, process.env.LTX_COMMAND?.trim() ? undefined : join(LTX_DIR, ".venv")),
        },
      }
    : {}),
  ...(whisper
    ? {
        whisper: {
          model: whisper.model,
          maxBytes: whisper.maxBytes,
          ready: () => whisperReadiness(whisper.command, process.env.WHISPER_COMMAND?.trim() ? undefined : join(WHISPER_DIR, ".venv")),
          transcribe: (file: string) => transcribeFile(whisper, file),
        },
      }
    : {}),
  outDir: process.env.OUT_DIR ?? join(tmpdir(), "troupe-renderer"),
  keepRendersS: keepHours * 3600,
  token: process.env.TOKEN || undefined,
  log,
});

// Generations run in their own process group, out of reach of Ctrl-C and
// of a container's stop signal: take them down with the renderer.
process.on("exit", stopGenerators);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(signal, () => {
    stopGenerators();
    process.kill(process.pid, signal);
  });
}

// PORT=0 picks a free port: print the one actually bound.
server.listen(PORT, HOST, () => {
  const address = server.address();
  const origin = `http://${HOST}:${typeof address === "object" && address ? address.port : PORT}`;
  log(`Troupe renderer on ${origin} (contract v1)`);
  if (whisper) log(`Transcription (faster-whisper ${whisper.model}, ${whisper.computeType}) on ${origin}/transcribe`);
  if (ltx) {
    const { width, height } = ltx.resolution;
    log(`AI video mode (LTX-Video) on ${origin}${LTX_PREFIX}: ${width}x${height}, ${ltx.frames} frames at ${ltx.frameRate} fps, upscaled with ${ltx.upscale}`);
  }
  // Fetch the voices now so the first render does not wait for the download.
  log(`Loading the Kokoro voices (${dtype}, downloaded once)…`);
  kokoro.load().catch((error: Error) => log(error.message));
});
