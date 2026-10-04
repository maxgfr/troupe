import { useMemo } from "react";
import type * as NextNavigation from "next/navigation";
import { useLocation, useNavigate } from "react-router";

// next/navigation on top of react-router, for the client pages in
// src/app/(app). Paths are app paths ("/projects/…"), as in Next.

export function useRouter() {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      push: (href: string) => void navigate(href),
      replace: (href: string) => void navigate(href, { replace: true }),
      back: () => void navigate(-1),
      forward: () => void navigate(1),
      // Every page here is a client page: there is no server render to redo.
      refresh: () => {},
      prefetch: () => {},
    }),
    [navigate],
  );
}

export function usePathname(): string {
  return useLocation().pathname;
}

// Next's read-only flavour only takes the mutators away.
export function useSearchParams(): NextNavigation.ReadonlyURLSearchParams {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search) as NextNavigation.ReadonlyURLSearchParams, [search]);
}

// Next throws to stop rendering; a full navigation does the same here.
export function redirect(href: string): never {
  window.location.assign(`${import.meta.env.BASE_URL}app${href}`);
  throw new Error(`Redirecting to ${href}`);
}

// Fails the typecheck when Next's signatures move away from these.
({ useRouter, usePathname, useSearchParams, redirect }) satisfies Pick<typeof NextNavigation, "useRouter" | "usePathname" | "useSearchParams" | "redirect">;
