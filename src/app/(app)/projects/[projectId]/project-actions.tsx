"use client";

import { useState } from "react";

import { Button, fieldSurface } from "~/app/_components/ui";

// Pure view — rename the project inline, or delete it after an explicit
// confirmation that says what goes with it.
export function ProjectActions({
  title,
  renderCount,
  busy,
  onRename,
  onDelete,
}: {
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
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) {
            onRename(name.trim());
            setMode("idle");
          }
        }}
      >
        <label className="sr-only" htmlFor="project-title">
          Project title
        </label>
        <input
          id="project-title"
          // biome-ignore lint/a11y/noAutofocus: the field appears because the user just asked to rename
          autoFocus
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          className={`${fieldSurface} w-64 max-w-full bg-surface px-3 py-1.5 text-sm`}
        />
        <Button type="submit" variant="primary" size="sm" disabled={busy || !name.trim()}>
          Save
        </Button>
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            setName(title);
            setMode("idle");
          }}
        >
          Cancel
        </Button>
      </form>
    );
  }
  if (mode === "delete") {
    return (
      <div
        role="alertdialog"
        aria-labelledby="delete-project-question"
        className="flex flex-wrap items-center gap-2 rounded-xl bg-danger/10 px-3 py-2 text-sm shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--troupe-color-danger)_40%,transparent)]"
      >
        <span id="delete-project-question">
          Delete “{title}”{renderCount ? ` and its ${renderCount} render${renderCount > 1 ? "s" : ""}` : ""}? This
          cannot be undone.
        </span>
        <Button variant="danger-solid" size="sm" disabled={busy} onClick={onDelete}>
          Delete
        </Button>
        <Button variant="quiet" size="sm" onClick={() => setMode("idle")}>
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Button variant="quiet" size="sm" onClick={() => setMode("rename")}>
        Rename
      </Button>
      <Button variant="quiet" size="sm" onClick={() => setMode("delete")}>
        Delete
      </Button>
    </span>
  );
}
