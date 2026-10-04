import { useEffect, useState, useSyncExternalStore } from "react";

import type { DemoRendering } from "~/app/_components/edition";
import { ProviderWarning } from "~/app/_components/ui";
import { BROWSER_MODEL_KEY } from "~/modules/generation";
import { api } from "~/trpc/react";
import { overallProgress, type RenderStage } from "./protocol";
import { onRenderFinished, renderStage, subscribeToRenders } from "./runner";
import { renderSupport, type RenderSupport } from "./support";
import { RENDER_CONFIG } from "./env";
import { voiceModelCached, weightsFor } from "./tts-cache";

// The project page's view of renders made in this browser.

const mb = (bytes: number) => Math.round(bytes / 1_000_000);

// What the row says, the figure beside it and how full the bar is. The bar
// follows the download first, then the render itself from voicing to saving.
function describe(stage: RenderStage | undefined): { label: string; figure: string | null; fraction: number | null } {
  switch (stage?.stage) {
    case undefined:
      return { label: "Rendering in this browser", figure: null, fraction: null };
    case "queued":
      return { label: "Waiting to start", figure: null, fraction: 0 };
    case "model":
      // The small config files come first; sizes mean something past a megabyte.
      return stage.totalBytes >= 1_000_000
        ? { label: "Loading the voice model", figure: `${mb(stage.loadedBytes)} / ${mb(stage.totalBytes)} MB`, fraction: stage.loadedBytes / stage.totalBytes }
        : { label: "Loading the voice model", figure: null, fraction: 0 };
    case "voice":
      return { label: "Voicing the script", figure: `line ${Math.min(stage.line + 1, stage.lines)} of ${stage.lines}`, fraction: overallProgress(stage) };
    case "frames":
      return { label: "Drawing the video", figure: `${Math.round(overallProgress(stage) * 100)}%`, fraction: overallProgress(stage) };
    case "saving":
      return { label: "Saving the video", figure: null, fraction: 1 };
  }
}

function RenderProgress({ providerJobId }: { providerJobId: string }) {
  const stage = useSyncExternalStore(subscribeToRenders, () => renderStage(providerJobId));
  const utils = api.useUtils();
  // The timeline polls every few seconds; a finished render shows at once.
  useEffect(
    () =>
      onRenderFinished((jobId) => {
        if (jobId === providerJobId) void utils.generation.forProject.invalidate();
      }),
    [providerJobId, utils],
  );
  const { label, figure, fraction } = describe(stage);
  const percent = fraction === null ? null : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <div className="w-full space-y-1.5 sm:w-72">
      {/* The row sits in a live region: the figures change too often to read out. */}
      <p aria-hidden className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-fg">{label}</span>
        {figure ? <span className="font-mono tabular-nums text-muted">{figure}</span> : null}
      </p>
      <div
        role="progressbar"
        aria-label="Render progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={figure ? `${label}, ${figure}` : label}
        className="progress-glow h-1.5 overflow-hidden rounded-full bg-primary/20"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out motion-reduce:transition-none"
          style={{ width: percent === null ? "50%" : `${Math.max(percent, 2)}%` }}
        />
      </div>
    </div>
  );
}

// Said before the first launch: where the render runs, what it downloads
// the first time, and that the tab must stay open.
function LaunchNote() {
  const [support, setSupport] = useState<RenderSupport | null>(null);
  const [cached, setCached] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void renderSupport().then(async (found) => {
      const inCache = found.ok ? await voiceModelCached(found.device) : false;
      if (!live) return;
      setSupport(found);
      setCached(inCache);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!support?.ok) return null;
  const download = cached
    ? "The voice model is already in this browser."
    : `The first render downloads the Kokoro voice model (about ${weightsFor(support.device).mb} MB) and keeps it in this browser.`;
  if (support.device === "wasm") {
    const why = RENDER_CONFIG.device === "wasm" ? "This studio makes the voices on the CPU" : "This browser has no WebGPU, so the voices are made on the CPU";
    return (
      <ProviderWarning>
        {why}, several times slower than on a GPU. {download} Keep this tab open until the video appears.
      </ProviderWarning>
    );
  }
  return (
    <p className="max-w-[72ch] text-pretty text-sm text-muted">
      Renders in this tab, with your GPU voicing the script. {download} Keep the tab open until the video appears.
    </p>
  );
}

export const browserRendering: DemoRendering = { modelKey: BROWSER_MODEL_KEY, LaunchNote, Progress: RenderProgress };
