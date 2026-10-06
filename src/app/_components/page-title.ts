"use client";

import { useEffect } from "react";

// Every screen's title, in both editions: the screen, then what it belongs
// to (a project, an item), then Troupe ("Script · Cold brew mornings ·
// Troupe"). The self-hosted studio also sets the static part per route on
// the server (each segment's layout.tsx), for the first paint.

export const APP_NAME = "Troupe";

export function pageTitle(...parts: (string | null | undefined)[]): string {
  return [...parts.filter((part): part is string => Boolean(part?.trim())), APP_NAME].join(" · ");
}

export function usePageTitle(...parts: (string | null | undefined)[]): void {
  const title = pageTitle(...parts);
  useEffect(() => {
    document.title = title;
  }, [title]);
}
