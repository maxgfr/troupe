"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CloseIcon } from "./icons";
import { Kbd } from "./ui";

// The studio's keyboard shortcuts (docs/PRODUCT-MAP.md). Single keys, as in
// Linear or Gmail: "g" then a letter goes somewhere, "n" starts a project,
// "/" searches the library, "?" lists them all. Never while typing, never
// with a modifier held, so the browser's own shortcuts stay untouched.

export const GO_TO = [
  { key: "p", href: "/dashboard", label: "Projects" },
  { key: "l", href: "/library", label: "Library" },
  { key: "a", href: "/actors", label: "Actors" },
  { key: "c", href: "/benchmark", label: "Compare" },
  { key: "s", href: "/settings", label: "Settings" },
] as const;

// A dialog open anywhere (this list, the chat's sheet, a confirmation) keeps
// the keys to itself, wherever the focus happens to be.
const OPEN_DIALOG = "dialog[open], [role='dialog'], [role='alertdialog']";

function busy(target: EventTarget | null): boolean {
  if (document.querySelector(OPEN_DIALOG)) return true;
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export function Shortcuts() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let leader = 0;
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || busy(event.target)) return;
      const key = event.key;
      if (leader && Date.now() - leader < 1200) {
        leader = 0;
        const destination = GO_TO.find((d) => d.key === key.toLowerCase());
        if (destination) {
          event.preventDefault();
          router.push(destination.href);
        }
        return;
      }
      if (key === "g") {
        leader = Date.now();
      } else if (key === "n") {
        event.preventDefault();
        router.push("/projects/new");
      } else if (key === "/") {
        const search = document.querySelector<HTMLInputElement>("[data-shortcut='search']");
        event.preventDefault();
        if (search) search.focus();
        else router.push("/library");
      } else if (key === "?") {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    // A browser without modal dialogs (and the tests' DOM) shows it in place.
    if (open && !node.open) {
      if (typeof node.showModal === "function") node.showModal();
      else node.setAttribute("open", "");
    }
    if (!open && node.open) {
      if (typeof node.close === "function") node.close();
      else node.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="shortcuts-title"
      onClose={() => setOpen(false)}
      onClick={(event) => {
        // A click on the backdrop (the dialog element itself) closes it.
        if (event.target === event.currentTarget) setOpen(false);
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl bg-raised p-0 text-fg shadow-overlay backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id="shortcuts-title" className="font-display text-xl font-semibold tracking-[-0.01em]">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="-mt-1 -mr-2 flex size-10 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-fg/[0.06] hover:text-fg"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
        <ShortcutList className="mt-5" />
      </div>
    </dialog>
  );
}

// The shortcuts, as the dialog and Settings list them.
export function ShortcutList({ className = "" }: { className?: string }) {
  return (
    <dl className={`space-y-3 text-sm ${className}`}>
      <div className="flex items-center justify-between gap-4">
        <dt>New project</dt>
        <dd>
          <Kbd>n</Kbd>
        </dd>
      </div>
      {GO_TO.map((d) => (
        <div key={d.key} className="flex items-center justify-between gap-4">
          <dt>Go to {d.label}</dt>
          <dd className="flex items-center gap-1 text-xs text-muted">
            <Kbd>g</Kbd> then <Kbd>{d.key}</Kbd>
          </dd>
        </div>
      ))}
      <div className="flex items-center justify-between gap-4">
        <dt>Search the library</dt>
        <dd>
          <Kbd>/</Kbd>
        </dd>
      </div>
      <div className="flex items-center justify-between gap-4">
        <dt>This list</dt>
        <dd>
          <Kbd>?</Kbd>
        </dd>
      </div>
    </dl>
  );
}
