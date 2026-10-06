"use client";

import { createContext, useContext, type ComponentType } from "react";

import { ExternalIcon } from "./icons";

// Which Troupe the pages run in. The self-hosted studio (Docker or a server)
// is the default. The browser edition (site/) runs the same pages with no
// server behind them: everything stays in the visitor's browser, so it can
// neither keep API keys nor reach model servers, and says so where it
// matters. It renders with its own model, in the page (site/src/render).
export type Edition =
  | { kind: "self-hosted" }
  | {
      kind: "browser";
      data: LocalData;
      rendering?: BrowserRendering;
      chat?: BrowserChat;
      library?: LibraryUploader;
    };

// How a file reaches the inspiration library: the self-hosted studio posts
// it to /api/library/upload (src/app/(app)/library/upload.ts); the browser
// edition keeps it in this browser and records it (site/src/library).
export interface LibraryUploader {
  upload(
    file: File,
    input: { workspaceId: string; mine: boolean; onProgress?: (fraction: number) => void },
  ): Promise<{ id: string }>;
  // Under the add bar: where the analysis runs and what it downloads first.
  Note?: ComponentType;
}

// The browser edition's own model, as the project page shows it.
export interface BrowserRendering {
  modelKey: string;
  // Under the launch controls, before any launch: what a render here takes.
  LaunchNote: ComponentType;
  // A render's live progress, in place of the timeline's generic bar.
  Progress: ComponentType<{ providerJobId: string }>;
}

// The browser edition's chat model, as the chat panel shows it.
export interface BrowserChat {
  // Above an empty chat: what the first message downloads and where it runs.
  Note: ComponentType;
  // While the model downloads or loads onto the GPU; nothing otherwise.
  Progress: ComponentType;
}

// What a backup holds, shown before it replaces anything.
export interface BackupSummary {
  createdAt: Date;
  projects: number;
  videos: number;
  bytes: number;
}

export interface BackupFile {
  summary: BackupSummary;
  // Replaces everything in this browser with the backup, then reloads.
  restore: () => Promise<void>;
}

// How much the browser holds for the studio, and how much it allows.
export interface StorageReport {
  usageBytes: number;
  quotaBytes: number;
}

// The browser edition's data, all of it on this device (site/src/data).
export interface LocalData {
  // Empties this browser's studio: projects, scripts, chat, renders, settings.
  deleteAll: () => Promise<void>;
  // Everything in one file to download.
  exportBackup: () => Promise<{ blob: Blob; filename: string }>;
  // Reads and checks a backup; nothing changes until `restore`.
  readBackup: (file: File) => Promise<BackupFile>;
  storage: {
    // Null when the browser does not say.
    estimate: () => Promise<StorageReport | null>;
    // Whether the browser keeps the data when space runs low; null when it cannot say.
    persisted: () => Promise<boolean | null>;
    // Asks the browser to keep the data; null when it cannot be asked.
    persist: () => Promise<boolean | null>;
  };
}

export const SELF_HOSTING_URL = "https://github.com/maxgfr/troupe/blob/main/docs/SELF-HOSTING.md";

const EditionContext = createContext<Edition>({ kind: "self-hosted" });

export const EditionProvider = EditionContext.Provider;

export function useEdition(): Edition {
  return useContext(EditionContext);
}

// What only the self-hosted studio can do, said once, calmly, where the
// control would be, with the way to get it.
export function NeedsSelfHosted({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-2xl rounded-2xl bg-surface/70 px-5 py-4 text-sm">
      <p className="text-pretty text-muted">{children}</p>
      <a
        href={SELF_HOSTING_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex min-h-9 items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
      >
        Set up the self-hosted studio
        <ExternalIcon className="size-4" />
      </a>
    </div>
  );
}
