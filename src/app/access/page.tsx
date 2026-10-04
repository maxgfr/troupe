"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wordmark } from "~/app/_components/wordmark";
import { ErrorNote } from "~/app/_components/ui";

export default function AccessPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
    <Wordmark />
    <h1 className="mt-10 font-display text-3xl font-semibold">Your private studio</h1>
    <p className="mt-3 text-sm leading-relaxed text-muted">Enter your access code to open Troupe. No account needed.</p>
    <p className="mt-2 text-xs leading-relaxed text-muted">Didn&apos;t set one? The server generated it on first start: run <code className="font-mono">docker compose logs app</code> or read <code className="font-mono">access-code</code> in the data volume.</p>
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
      <input id="access-code" type="password" autoComplete="current-password" required value={code} onChange={(event) => setCode(event.target.value)} className="w-full rounded-lg border border-muted/40 bg-surface px-4 py-3" />
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <button type="submit" disabled={pending || !code} className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-on-primary hover:opacity-90 disabled:opacity-40">{pending ? "Opening…" : "Open studio"}</button>
    </form>
  </main>;
}
