"use client";

import { useEdition } from "./edition";
import { usePageTitle } from "./page-title";
import { EmptyState, PageHeader } from "./ui";

// An address the studio does not know (docs/PRODUCT-MAP.md, "any other"), in
// both editions: what may have happened, and the way back.
export function NotFoundPage() {
  usePageTitle("Page not found");
  const where = useEdition().kind === "browser" ? "this browser" : "this studio";
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        title="Nothing at this address"
        body={`The link may point to a page that no longer exists, or to a project deleted from ${where}.`}
        cta={{ label: "Back to your projects", href: "/dashboard" }}
      />
    </>
  );
}
