"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePageTitle } from "~/app/_components/page-title";
import { Wordmark } from "~/app/_components/wordmark";
import { Button, ErrorNote, fieldSurface } from "~/app/_components/ui";

export default function AccessPage() {
  usePageTitle("Your private studio");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <div className="relative isolate min-h-dvh">
    <div aria-hidden className="stage-wash" />
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
    <Wordmark className="text-[1.75rem]" />
    <h1 className="mt-10 font-display text-[2rem] leading-[1.1] font-semibold tracking-[-0.02em] sm:text-[2.5rem]">Your private studio</h1>
    <p className="mt-3 text-pretty text-[0.9375rem] leading-relaxed text-muted">Enter your access code to open Troupe. No account needed.</p>
    <p className="mt-2 text-pretty text-xs leading-relaxed text-muted">Didn&apos;t set one? The server generated it on first start: run <code className="font-mono">docker compose logs app</code> or read <code className="font-mono">access-code</code> in the data volume.</p>
    <form className="mt-8 space-y-4" onSubmit={async (event) => {
      event.preventDefault(); setPending(true); setError(null);
      try {
        const response = await fetch("/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
        if (!response.ok) throw new Error(response.status === 401 ? "This access code is incorrect." : response.status === 429 ? "Too many wrong codes. Wait a few minutes and try again." : "The studio could not be opened. Try again.");
        router.replace("/dashboard"); router.refresh();
      } catch (error) { setError(error instanceof Error ? error.message : "Could not open the studio."); }
      finally { setPending(false); }
    }}>
      <label htmlFor="access-code" className="block text-sm font-medium">Access code</label>
      <input id="access-code" type="password" autoComplete="current-password" required value={code} onChange={(event) => setCode(event.target.value)} className={`${fieldSurface} w-full bg-surface px-4 py-3 text-base`} />
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <Button type="submit" variant="primary" size="lg" disabled={pending || !code} className="w-full">{pending ? "Opening…" : "Open studio"}</Button>
    </form>
    </main>
  </div>;
}
