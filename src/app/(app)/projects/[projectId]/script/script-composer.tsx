"use client";

// Script editor with versioned saves. It opens on the current version's text;
// remount it (key) when a new version arrives.

import { useState } from "react";

import { ErrorNote } from "~/app/_components/ui";
import { estimateSeconds } from "./estimate";

export function ScriptComposer({
  pending,
  enabled,
  initialText = "",
  errorMessage,
  onSave,
}: {
  pending: boolean;
  enabled: boolean;
  initialText?: string;
  errorMessage?: string | null;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState(initialText);
  const changed = draft.trim() !== initialText.trim();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.trim() || !changed) return;
        onSave(draft.trim());
      }}
      className="space-y-2"
    >
      <label className="block text-sm font-medium" htmlFor="script-composer">
        {initialText ? "Edit script" : "Write or paste your script"}
      </label>
      <textarea
        id="script-composer"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={6}
        placeholder={"Hook line…\nBody line…\nCall to action…"}
        className="w-full rounded-lg border border-muted/40 bg-bg px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-primary"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted">One line per sentence · ≈{estimateSeconds(draft)}s spoken · unchanged lines keep their emotion</span>
        <button
          type="submit"
          disabled={pending || !draft.trim() || !changed || !enabled}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save as new version"}
        </button>
      </div>
      {errorMessage ? <ErrorNote>{errorMessage}</ErrorNote> : null}
    </form>
  );
}
