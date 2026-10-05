"use client";

import { useEffect, useRef, useState } from "react";

import type { BackupFile, LocalData, StorageReport } from "./edition";
import { ErrorNote } from "./ui";

// The browser edition's data, in Settings: how much this browser holds and
// whether it may clear it, a backup to export or import, and deleting it all.

const message = (cause: unknown, fallback: string) => (cause instanceof Error && cause.message ? cause.message : fallback);

// 1.2 GB, 48 MB, 820 KB: two significant figures are plenty for storage.
export function formatBytes(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  if (unit === 0) return `${bytes} bytes`;
  return `${value >= 100 ? Math.round(value) : Number(value.toPrecision(2))} ${units[unit]}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const BUTTON = "rounded-lg border border-muted/30 px-3 py-1.5 text-sm transition-[background-color,transform] duration-150 hover:bg-surface active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40";

// A calm word on where the data lives, until the visitor has read it.
const NOTE_KEY = "troupe-local-data-note";

function LocalNote() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    try {
      setShown(localStorage.getItem(NOTE_KEY) !== "dismissed");
    } catch {
      setShown(true);
    }
  }, []);
  if (!shown) return null;
  function dismiss() {
    setShown(false);
    try {
      localStorage.setItem(NOTE_KEY, "dismissed");
    } catch {
      // Private windows may refuse: the note simply comes back next time.
    }
  }
  return (
    <p className="mb-4 flex max-w-2xl items-center justify-between gap-3 rounded-lg bg-surface py-1 pl-3 pr-1 text-sm text-muted">
      <span className="text-pretty">Troupe runs in your browser: your projects stay on this device.</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:text-fg">
        <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="size-4">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </p>
  );
}

function Row({ title, description, children }: { title: string; description: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-3 px-4 py-4">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <div className="mt-1 max-w-[65ch] text-pretty text-sm text-muted">{description}</div>
      </div>
      {children}
    </div>
  );
}

function StorageRow({ storage }: { storage: LocalData["storage"] }) {
  const [report, setReport] = useState<StorageReport | null | undefined>(undefined);
  const [kept, setKept] = useState<boolean | null | undefined>(undefined);
  const [asked, setAsked] = useState<"idle" | "busy" | "declined">("idle");
  useEffect(() => {
    let live = true;
    storage.estimate().then((r) => live && setReport(r), () => live && setReport(null));
    storage.persisted().then((p) => live && setKept(p), () => live && setKept(null));
    return () => {
      live = false;
    };
  }, [storage]);

  async function ask() {
    setAsked("busy");
    const granted = await storage.persist().catch(() => null);
    setKept(granted);
    setAsked(granted ? "idle" : "declined");
  }

  const used =
    report === undefined ? (
      <span className="inline-block h-4 w-40 animate-pulse rounded bg-surface align-middle" />
    ) : report === null ? (
      "This browser does not say how much space the studio uses."
    ) : (
      <>
        <span className="font-mono text-xs tabular-nums text-fg">{formatBytes(report.usageBytes)}</span> used, of about{" "}
        <span className="font-mono text-xs tabular-nums">{formatBytes(report.quotaBytes)}</span> this browser allows the studio.
      </>
    );

  return (
    <Row title="Storage" description={used}>
      {kept === true ? (
        <p className="flex items-center gap-2 text-sm">
          <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 text-success">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
          Kept: this browser will not clear it to free up space.
        </p>
      ) : kept === false ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="button" onClick={() => void ask()} disabled={asked === "busy"} className={BUTTON}>
            {asked === "busy" ? "Asking…" : "Keep it on this device"}
          </button>
          <p className="max-w-[60ch] text-pretty text-xs text-muted" role="status">
            {asked === "declined"
              ? "The browser said no for now. Browsers grant it to sites you use often or install; a backup keeps your work safe either way."
              : "When the device runs low on space, the browser may clear site data. This asks it to keep the studio's."}
          </p>
        </div>
      ) : null}
    </Row>
  );
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // The download has started from the link; the URL is no longer needed.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const savedOn = (date: Date) =>
  date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function BackupRow({ data }: { data: LocalData }) {
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "reading" | "confirm" | "restoring">("idle");
  const [backup, setBackup] = useState<BackupFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (mode === "confirm") cancelRef.current?.focus();
  }, [mode]);

  async function exportAll() {
    setExporting(true);
    setExported(null);
    setError(null);
    try {
      const { blob, filename } = await data.exportBackup();
      save(blob, filename);
      setExported(`Saved ${filename} (${formatBytes(blob.size)}).`);
    } catch (cause) {
      setError(message(cause, "The backup could not be made."));
    } finally {
      setExporting(false);
    }
  }

  async function read(file: File) {
    setMode("reading");
    setExported(null);
    setError(null);
    try {
      setBackup(await data.readBackup(file));
      setMode("confirm");
    } catch (cause) {
      setError(message(cause, "This file could not be read as a backup."));
      setMode("idle");
    }
  }

  async function restore() {
    if (!backup) return;
    setMode("restoring");
    setError(null);
    try {
      await backup.restore();
    } catch (cause) {
      setError(message(cause, "The backup could not be imported. Nothing was changed."));
      setMode("confirm");
    }
  }

  function cancel() {
    setBackup(null);
    setMode("idle");
  }

  const summary = backup?.summary;
  return (
    <Row
      title="Backup"
      description="One file with every project, script, chat, render and setting. Import it in another browser, or here after clearing your data."
    >
      {mode === "confirm" || mode === "restoring" ? (
        summary ? (
          <div role="alertdialog" aria-labelledby="import-question" className="max-w-2xl space-y-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-3 text-sm">
            <p id="import-question" className="text-pretty">
              Replace everything in this browser with this backup? It holds {plural(summary.projects, "project", "projects")}
              {summary.videos > 0 ? (
                <>
                  {" "}and {plural(summary.videos, "video", "videos")} (
                  <span className="font-mono text-xs tabular-nums">{formatBytes(summary.bytes)}</span>)
                </>
              ) : null}
              , saved {savedOn(summary.createdAt)}. What is here now is deleted.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={mode === "restoring"}
                onClick={() => void restore()}
                className="rounded-lg bg-danger px-3 py-1.5 text-sm font-medium text-on-primary transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.96] disabled:opacity-40"
              >
                {mode === "restoring" ? "Importing…" : "Replace with backup"}
              </button>
              <button ref={cancelRef} type="button" disabled={mode === "restoring"} onClick={cancel} className="px-2 py-1.5 text-sm text-muted transition-colors duration-150 hover:text-fg disabled:opacity-40">
                Cancel
              </button>
            </div>
          </div>
        ) : null
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void exportAll()} disabled={exporting || mode === "reading"} className={BUTTON}>
            {exporting ? "Preparing…" : "Export data"}
          </button>
          <button type="button" onClick={() => picker.current?.click()} disabled={exporting || mode === "reading"} className={BUTTON}>
            {mode === "reading" ? "Reading…" : "Import data…"}
          </button>
          <input
            ref={picker}
            type="file"
            accept=".tar,application/x-tar"
            aria-label="Backup file to import"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void read(file);
            }}
          />
          {exported ? (
            <p role="status" className="text-xs text-muted">
              {exported}
            </p>
          ) : null}
        </div>
      )}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </Row>
  );
}

// Empties the studio after an explicit confirmation that says what goes,
// in the same inline pattern as deleting a project.
export function DeleteLocalData({ deleteAll }: { deleteAll: () => Promise<void> }) {
  const [mode, setMode] = useState<"idle" | "confirm" | "busy">("idle");
  const [error, setError] = useState<string | null>(null);
  // Keyboard focus follows the question, then returns to the button.
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (mode === "confirm") cancelRef.current?.focus();
    if (mode === "idle" && asked.current) deleteRef.current?.focus();
    if (mode !== "idle") asked.current = true;
  }, [mode]);
  async function run() {
    setMode("busy");
    setError(null);
    try {
      await deleteAll();
    } catch (cause) {
      setError(message(cause, "The data could not be deleted."));
      setMode("confirm");
    }
  }
  return (
    <div className="space-y-2">
      {mode === "idle" ? (
        <button
          ref={deleteRef}
          type="button"
          onClick={() => setMode("confirm")}
          className="rounded-lg border border-danger/40 px-3 py-1.5 text-sm text-danger transition-[background-color,transform] duration-150 hover:bg-danger/10 active:scale-[0.96]"
        >
          Delete all local data
        </button>
      ) : (
        <div role="alertdialog" aria-labelledby="delete-local-question" className="flex max-w-2xl flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
          <span id="delete-local-question" className="text-pretty">
            Delete every project, script, chat, render and setting saved in this browser? This cannot be undone.
          </span>
          <button
            type="button"
            disabled={mode === "busy"}
            onClick={() => void run()}
            className="rounded-lg bg-danger px-3 py-1 text-sm font-medium text-on-primary transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.96] disabled:opacity-40"
          >
            {mode === "busy" ? "Deleting…" : "Delete everything"}
          </button>
          <button ref={cancelRef} type="button" disabled={mode === "busy"} onClick={() => setMode("idle")} className="px-2 py-1 text-sm text-muted hover:text-fg disabled:opacity-40">
            Cancel
          </button>
        </div>
      )}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </div>
  );
}

export function LocalDataSettings({ data }: { data: LocalData }) {
  return (
    <>
      <LocalNote />
      <div className="max-w-2xl divide-y divide-muted/15 rounded-xl border border-muted/20">
        <StorageRow storage={data.storage} />
        <BackupRow data={data} />
        <Row title="Start over" description="Empties the studio in this browser, in every open tab. Export a backup first to keep a copy.">
          <DeleteLocalData deleteAll={data.deleteAll} />
        </Row>
      </div>
    </>
  );
}
