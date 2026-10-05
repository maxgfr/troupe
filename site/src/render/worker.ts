import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";

import type { BrowserRenderJob } from "~/modules/generation";
import { assembleTrack, buildScene, portraitShots, SCENE_FONT, voiceFor, type Speech } from "~/modules/scene";
import { encodeScene } from "./encode";
import { RENDER_CONFIG } from "./env";
import { loadPortraits } from "./portraits";
import type { FromWorker, RenderStage, ToWorker } from "./protocol";
import { loadVoice } from "./tts";

// Renders one job at a time: Kokoro voices each line, the shared scene is
// laid out on the measured speech (exactly as the Node renderer does), then
// every frame is drawn and encoded. The page queues the jobs.

interface WorkerScope {
  fonts: FontFaceSet;
  postMessage(message: FromWorker): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;

let fontReady: Promise<void> | undefined;

// The scene draws in Geist (SCENE_FONT). A worker sees none of the page's
// fonts, so it loads the app's own Geist file under that exact family name.
function loadSceneFont(): Promise<void> {
  fontReady ??= (async () => {
    const face = new FontFace(SCENE_FONT, `url(${geistLatin})`, { weight: "100 900" });
    scope.fonts.add(await face.load());
  })().catch((error: unknown) => {
    fontReady = undefined;
    throw new Error(`The caption font could not load: ${error instanceof Error ? error.message : String(error)}.`);
  });
  return fontReady;
}

async function render(jobId: string, job: BrowserRenderJob): Promise<Blob> {
  const report = (stage: RenderStage) => scope.postMessage({ type: "progress", jobId, stage });
  const [voice] = await Promise.all([
    loadVoice((download) => report({ stage: "model", ...download })),
    loadSceneFont(),
  ]);

  const { lines, actor } = job.script;
  const speeches: Speech[] = [];
  report({ stage: "voice", line: 0, lines: lines.length, device: voice.device });
  for (const line of lines) {
    speeches.push(await voice.speak(line.text, voiceFor(actor, line.emotion, RENDER_CONFIG.voices)));
    report({ stage: "voice", line: speeches.length, lines: lines.length, device: voice.device });
  }

  const scene = buildScene({
    width: job.width,
    height: job.height,
    fps: job.fps,
    actor,
    lines,
    speechS: speeches.map((s) => s.samples.length / s.sampleRate),
  });
  const portraits = await loadPortraits(actor.portraits, portraitShots(scene), import.meta.env.BASE_URL);
  try {
    const video = await encodeScene(scene, assembleTrack(speeches, scene), portraits, (frame, frames) => report({ stage: "frames", frame, frames }));
    report({ stage: "saving" });
    return video;
  } finally {
    for (const picture of Object.values(portraits)) picture.close();
  }
}

// Renders run one after another, in the order the page sent them.
let queue: Promise<void> = Promise.resolve();

scope.onmessage = ({ data }) => {
  if (data.type !== "render") return;
  queue = queue.then(async () => {
    try {
      scope.postMessage({ type: "done", jobId: data.jobId, video: await render(data.jobId, data.job) });
    } catch (error) {
      scope.postMessage({ type: "failed", jobId: data.jobId, message: error instanceof Error ? error.message : "The render failed." });
    }
  });
};
