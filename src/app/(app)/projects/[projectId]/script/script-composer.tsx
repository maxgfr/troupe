"use client";

// Script editor with versioned saves. It opens on the current version's text;
// remount it (key) when a new version arrives.

import { useState } from "react";

import { Button, ErrorNote, ProviderWarning, fieldSurface } from "~/app/_components/ui";
import { estimateSeconds } from "./estimate";

export function ScriptComposer({
  pending,
  enabled,
  initialText = "",
  errorMessage,
  limit,
  onSave,
}: {
  pending: boolean;
  enabled: boolean;
  initialText?: string;
  errorMessage?: string | null;
  // The longest clip the project's model renders, to flag a script that
  // will not fit while it is being written rather than at launch.
  limit?: { seconds: number; modelLabel: string } | null;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState(initialText);
  const changed = draft.trim() !== initialText.trim();
  const spokenS = estimateSeconds(draft);
  const tooLong = Boolean(limit && spokenS > limit.seconds);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.trim() || !changed) return;
        onSave(draft.trim());
      }}
      className="space-y-2"
    >
      <label className="block text-xl font-semibold tracking-[-0.01em]" htmlFor="script-composer">
        {initialText ? "Edit script" : "Write or paste your script"}
      </label>
      <textarea
        id="script-composer"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={6}
        placeholder={"Hook line…\nBody line…\nCall to action…"}
        className={`${fieldSurface} mt-2 w-full bg-surface px-4 py-3 text-base leading-relaxed`}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted">
          One line per sentence ·{" "}
          <span className={`font-mono tabular-nums ${tooLong ? "text-warning" : ""}`}>
            ≈{spokenS} s spoken{limit ? ` of ${limit.seconds} s` : ""}
          </span>{" "}
          · unchanged lines keep their emotion
        </span>
        <Button type="submit" variant="primary" disabled={pending || !draft.trim() || !changed || !enabled}>
          {pending ? "Saving…" : "Save as new version"}
        </Button>
      </div>
      {tooLong && limit ? (
        <ProviderWarning>
          This takes about {spokenS} s to say, but {limit.modelLabel} renders at most {limit.seconds} s. Cut a few
          words, or pick another model on the Video tab.
        </ProviderWarning>
      ) : null}
      {errorMessage ? <ErrorNote>{errorMessage}</ErrorNote> : null}
    </form>
  );
}
