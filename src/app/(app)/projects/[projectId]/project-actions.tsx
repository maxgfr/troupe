"use client";

import { useState } from "react";

// Pure view — rename the project inline, or delete it after an explicit
// confirmation that says what goes with it.
export function ProjectActions({ title, renderCount, busy, onRename, onDelete }: {
  title: string;
  renderCount: number;
  busy?: boolean;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "rename" | "delete">("idle");
  const [name, setName] = useState(title);
  if (mode === "rename") {
    return (
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onRename(name.trim()); setMode("idle"); } }}>
        <label className="sr-only" htmlFor="project-title">Project title</label>
        {/* biome-ignore lint/a11y/noAutofocus: the field appears because the user just asked to rename */}
        <input id="project-title" autoFocus value={name} maxLength={200} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-muted/40 bg-bg px-3 py-1.5 text-sm" />
        <button type="submit" disabled={busy || !name.trim()} className="rounded-lg bg-primary px-3 py-1.5 text-sm text-on-primary disabled:opacity-40">Save</button>
        <button type="button" onClick={() => { setName(title); setMode("idle"); }} className="px-2 py-1.5 text-sm text-muted hover:text-fg">Cancel</button>
      </form>
    );
  }
  if (mode === "delete") {
    return (
      <div role="alertdialog" aria-labelledby="delete-project-question" className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
        <span id="delete-project-question">
          Delete “{title}”{renderCount ? ` and its ${renderCount} render${renderCount > 1 ? "s" : ""}` : ""}? This cannot be undone.
        </span>
        <button type="button" disabled={busy} onClick={onDelete} className="rounded-lg bg-danger px-3 py-1 text-sm font-medium text-on-primary disabled:opacity-40">Delete</button>
        <button type="button" onClick={() => setMode("idle")} className="px-2 py-1 text-sm text-muted hover:text-fg">Cancel</button>
      </div>
    );
  }
  return (
    <span className="flex items-center gap-3 text-sm">
      <button type="button" onClick={() => setMode("rename")} className="text-muted hover:text-fg">Rename</button>
      <button type="button" onClick={() => setMode("delete")} className="text-muted hover:text-danger">Delete</button>
    </span>
  );
}
