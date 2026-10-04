"use client";

import { useSyncExternalStore } from "react";

// Whether a media query matches, kept up to date. The server, and browsers
// without matchMedia (jsdom), answer `serverValue`.
export function useMediaQuery(query: string, serverValue = true): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => (typeof window === "undefined" || !window.matchMedia ? serverValue : window.matchMedia(query).matches),
    () => serverValue,
  );
}
