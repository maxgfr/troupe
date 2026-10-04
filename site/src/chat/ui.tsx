import { useEffect, useState, useSyncExternalStore } from "react";

import type { DemoChat } from "~/app/_components/edition";
import { CHAT_CONFIG } from "./env";
import { chatModelCached, chatModelStage, chatSupport, subscribeToChatModel, type ChatModelStage } from "./webllm";

// The chat panel's view of the in-browser model: what it downloads before
// the first answer, and how far along it is.

function describe(stage: ChatModelStage): { label: string; figure: string | null; fraction: number | null } | null {
  switch (stage.stage) {
    case "download":
      return stage.loadedMb > 0
        ? { label: "Downloading the chat model", figure: `${stage.loadedMb}${CHAT_CONFIG.downloadMb ? ` / ${CHAT_CONFIG.downloadMb}` : ""} MB`, fraction: stage.fraction }
        : { label: "Downloading the chat model", figure: null, fraction: 0 };
    case "load":
      return { label: "Loading the chat model onto the GPU", figure: `${Math.round(stage.fraction * 100)}%`, fraction: stage.fraction };
    default:
      return null;
  }
}

function ChatModelProgress() {
  const stage = useSyncExternalStore(subscribeToChatModel, chatModelStage);
  const shown = describe(stage);
  if (!shown) return null;
  const percent = shown.fraction === null ? null : Math.round(Math.min(1, Math.max(0, shown.fraction)) * 100);
  return (
    <div className="space-y-1.5">
      <p aria-hidden className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-fg">{shown.label}</span>
        {shown.figure ? <span className="font-mono tabular-nums text-muted">{shown.figure}</span> : null}
      </p>
      <div
        role="progressbar"
        aria-label="Chat model"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={shown.figure ? `${shown.label}, ${shown.figure}` : shown.label}
        className="progress-glow h-1.5 overflow-hidden rounded-full bg-primary/20"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out motion-reduce:transition-none" style={{ width: `${Math.max(percent ?? 0, 2)}%` }} />
      </div>
    </div>
  );
}

// Said before the first request: where the model runs and what it costs.
function ChatModelNote() {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void chatSupport().then(async (support) => {
      if (!support.ok) return;
      const cached = await chatModelCached(support.model);
      if (!live) return;
      const size = CHAT_CONFIG.downloadMb ? ` (about ${CHAT_CONFIG.downloadMb} MB)` : "";
      setNote(
        cached
          ? "The chat model runs in this tab, on your GPU, and is already in this browser."
          : `The chat model runs in this tab, on your GPU. Your first request downloads it${size} and keeps it in this browser.`,
      );
    });
    return () => {
      live = false;
    };
  }, []);
  return note ? <p className="text-pretty text-xs text-muted">{note}</p> : null;
}

export const browserChat: DemoChat = { Note: ChatModelNote, Progress: ChatModelProgress };
