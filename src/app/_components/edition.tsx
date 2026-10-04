"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

import { ErrorNote } from "./ui";

// Which Troupe the pages run in. The self-hosted studio is the default; the
// static browser demo (site/) runs the same pages with no server behind
// them, so it can neither keep API keys nor reach model servers, and says so.
export type Edition =
  | { kind: "studio" }
  | {
      kind: "demo";
      // Empties this browser's studio: projects, scripts, renders.
      resetData: () => Promise<void>;
    };

export const SELF_HOSTING_URL = "https://github.com/maxgfr/troupe#quick-start-docker";

const EditionContext = createContext<Edition>({ kind: "studio" });

export const EditionProvider = EditionContext.Provider;

export function useEdition(): Edition {
  return useContext(EditionContext);
}

// What the demo cannot do, said once, calmly, where the control would be.
export function DemoUnavailable({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-2xl rounded-xl border border-muted/25 px-4 py-3 text-sm">
      <p className="text-pretty text-muted">{children}</p>
      <a
        href={SELF_HOSTING_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-1 inline-block py-1 text-primary underline-offset-4 hover:underline"
      >
        Run Troupe on your machine ↗
      </a>
    </div>
  );
}

// A quiet strip above the studio's top bar: where the visitor is, and that
// their work never leaves the browser.
export function DemoBanner() {
  return (
    <aside aria-label="Browser demo" className="border-b border-muted/20 bg-bg">
      <p className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-xs text-muted sm:px-6">
        <span>
          <span className="font-medium text-fg">Browser demo.</span> Your work is saved in this browser and never leaves it.
        </span>
        <a href={SELF_HOSTING_URL} target="_blank" rel="noreferrer" className="-my-1 inline-block py-1 text-primary underline-offset-4 hover:underline">
          Run Troupe on your machine ↗
        </a>
      </p>
    </aside>
  );
}

// Empties the demo studio after an explicit confirmation that says what goes,
// in the same inline pattern as deleting a project.
export function ResetDemoData({ resetData }: { resetData: () => Promise<void> }) {
  const [mode, setMode] = useState<"idle" | "confirm" | "busy">("idle");
  const [error, setError] = useState<string | null>(null);
  // Keyboard focus follows the question, then returns to the button.
  const cancelRef = useRef<HTMLButtonElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (mode === "confirm") cancelRef.current?.focus();
    if (mode === "idle" && asked.current) resetRef.current?.focus();
    if (mode !== "idle") asked.current = true;
  }, [mode]);
  async function reset() {
    setMode("busy");
    setError(null);
    try {
      await resetData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The demo data could not be reset.");
      setMode("confirm");
    }
  }
  return (
    <div className="space-y-2">
      {mode === "idle" ? (
        <button
          ref={resetRef}
          type="button"
          onClick={() => setMode("confirm")}
          className="rounded-lg border border-danger/40 px-4 py-2 text-sm text-danger transition-colors duration-150 hover:bg-danger/10"
        >
          Reset demo data
        </button>
      ) : (
        <div role="alertdialog" aria-labelledby="reset-demo-question" className="flex max-w-2xl flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
          <span id="reset-demo-question" className="text-pretty">
            Delete every project, script and render saved in this browser? This cannot be undone.
          </span>
          <button
            type="button"
            disabled={mode === "busy"}
            onClick={() => void reset()}
            className="rounded-lg bg-danger px-3 py-1 text-sm font-medium text-on-primary disabled:opacity-40"
          >
            {mode === "busy" ? "Resetting…" : "Delete everything"}
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
