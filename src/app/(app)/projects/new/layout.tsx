import type { Metadata } from "next";

// The title before the page sets its own (src/app/_components/page-title.ts).
export const metadata: Metadata = { title: "New project" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
