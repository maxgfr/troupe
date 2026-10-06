"use client";

import { useId, useRef, useState } from "react";

import type { LibraryUploader } from "~/app/_components/edition";
import { ErrorNote } from "~/app/_components/ui";
import { api } from "~/trpc/react";
import { looksLikeLink, sizeLabel } from "./format";

const ACCEPT = "video/*,audio/*,image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,.txt,.md";

interface Upload {
  id: string;
  name: string;
  fraction: number | null;
}

// One field for a link or a text, Upload beside it, and the whole bar takes
// dropped files. "My own content" marks what is saved for the style profile.
export function AddBar({ workspaceId, uploader, canFetchLinks, maxUploadBytes, onAdded }: { workspaceId: string; uploader: LibraryUploader; canFetchLinks: boolean; maxUploadBytes: number | null; onAdded: (itemId: string) => void }) {
  const fieldId = useId();
  const mineId = useId();
  const hintId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const utils = api.useUtils();
  const [draft, setDraft] = useState("");
  const [mine, setMine] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const refresh = () => utils.library.list.invalidate();
  const addText = api.library.addText.useMutation();
  const addUrl = api.library.addUrl.useMutation();
  const saving = addText.isPending || addUrl.isPending;
  const link = looksLikeLink(draft);

  async function save() {
    const value = draft.trim();
    if (!value || saving) return;
    setError(null);
    try {
      if (looksLikeLink(value)) {
        if (!canFetchLinks) {
          setError("A page in your browser cannot fetch other sites. Save the video or the page to a file and upload it, or paste its text.");
          return;
        }
        const item = await addUrl.mutateAsync({ workspaceId, url: value, mine });
        onAdded(item.id);
      } else {
        const item = await addText.mutateAsync({ workspaceId, text: value, mine });
        onAdded(item.id);
      }
      setDraft("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function upload(files: FileList | File[]) {
    setError(null);
    for (const file of Array.from(files)) {
      if (maxUploadBytes !== null && file.size > maxUploadBytes) {
        setError(`${file.name} is larger than ${sizeLabel(maxUploadBytes)}, the most this studio takes.`);
        continue;
      }
      // Two files of the same name are two uploads.
      const uploadId = crypto.randomUUID();
      setUploads((list) => [...list, { id: uploadId, name: file.name, fraction: 0 }]);
      try {
        const { id } = await uploader.upload(file, {
          workspaceId,
          mine,
          onProgress: (fraction) => setUploads((list) => list.map((u) => (u.id === uploadId ? { ...u, fraction } : u))),
        });
        onAdded(id);
        await refresh();
      } catch (e) {
        setError(`${file.name}: ${(e as Error).message}`);
      } finally {
        setUploads((list) => list.filter((u) => u.id !== uploadId));
      }
    }
  }

  return (
    <div
      role="group"
      aria-label="Save to the library"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        setDragging(false);
        void upload(event.dataTransfer.files);
      }}
      className={`rounded-xl border px-3 py-3 transition-colors duration-150 sm:px-4 ${dragging ? "border-dashed border-primary bg-primary/10" : "border-muted/25"}`}
    >
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label htmlFor={fieldId} className="sr-only">
          {canFetchLinks ? "A link or a text to save" : "A text to save"}
        </label>
        <textarea
          id={fieldId}
          rows={draft.includes("\n") ? 4 : 1}
          value={draft}
          aria-describedby={hintId}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !draft.includes("\n")) {
              event.preventDefault();
              void save();
            }
          }}
          placeholder={canFetchLinks ? "Paste a link or a text" : "Paste a text, or upload a file"}
          className="min-h-10 w-full flex-1 resize-y rounded-lg border border-muted/30 bg-bg px-3 py-2 text-sm placeholder:text-muted/80"
        />
        <div className="flex gap-2">
          <button type="submit" disabled={!draft.trim() || saving} className="min-h-10 flex-1 rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary transition-opacity duration-150 hover:opacity-90 disabled:opacity-40 sm:flex-none">
            {saving ? (link ? "Fetching…" : "Saving…") : link ? "Save link" : "Save"}
          </button>
          <button type="button" onClick={() => fileInput.current?.click()} className="min-h-10 flex-1 rounded-lg border border-muted/30 px-4 text-sm transition-colors duration-150 hover:border-muted/60 sm:flex-none">
            Upload a file
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              if (event.target.files?.length) void upload(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
      </form>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <label htmlFor={mineId} className="flex min-h-9 items-center gap-2 text-sm">
          <input id={mineId} type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="size-4 accent-[var(--troupe-color-primary)]" />
          It is my own content
        </label>
        <p id={hintId} className="text-xs text-muted">
          {canFetchLinks ? "Links to videos and pages; videos, sound, pictures, PDFs and text files, dropped here or uploaded." : "Videos, sound, pictures, PDFs and text files, dropped here or uploaded. Links need the self-hosted studio."}
          {maxUploadBytes ? <span className="font-mono tabular-nums"> · up to {sizeLabel(maxUploadBytes)}</span> : null}
        </p>
      </div>
      {uploads.length > 0 ? (
        <ul className="mt-3 space-y-2" aria-live="polite">
          {uploads.map((u) => (
            <li key={u.id} className="space-y-1">
              <p className="flex justify-between gap-3 text-xs">
                <span className="truncate">Uploading {u.name}</span>
                <span className="font-mono tabular-nums text-muted">{u.fraction === null ? "" : `${Math.round(u.fraction * 100)}%`}</span>
              </p>
              <div className="h-1 overflow-hidden rounded-full bg-primary/20">
                <div className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out motion-reduce:transition-none" style={{ width: `${Math.max(2, Math.round((u.fraction ?? 0) * 100))}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
    </div>
  );
}
