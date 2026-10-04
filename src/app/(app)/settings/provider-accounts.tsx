"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { ErrorNote } from "~/app/_components/ui";
import { ConnectionResult, type Report } from "./connection-result";

const ACCOUNTS = [
  { id: "google", name: "Google AI", models: "Veo 3.1 Fast", href: "https://aistudio.google.com/apikey" },
  { id: "fal", name: "fal.ai", models: "Kling 3.0 · Seedance 1.5 Pro", href: "https://fal.ai/dashboard/keys" },
  { id: "anthropic", name: "Anthropic", models: "Claude, for the script chat", href: "https://console.anthropic.com/settings/keys" },
] as const;

const SOURCE_LABEL: Record<string, string> = {
  saved: "Saved key",
  environment: "From the environment",
  disabled: "Turned off",
  none: "Not configured",
  undecryptable: "Saved key unreadable — enter it again",
};

// Cloud provider accounts. Keys are encrypted at rest and never sent back.
export function ProviderAccounts() {
  const utils = api.useUtils();
  const status = api.settings.credentials.status.useQuery();
  const [keys, setKeys] = useState({ google: "", fal: "", anthropic: "" });
  const [reports, setReports] = useState<Record<string, Report | undefined>>({});
  const refresh = () => Promise.all([utils.settings.credentials.status.invalidate(), utils.settings.models.list.invalidate(), utils.studio.modelOptions.invalidate(), utils.settings.chat.get.invalidate()]);
  const save = api.settings.credentials.save.useMutation({ onSuccess: async (_d, input) => { setKeys((k) => ({ ...k, [input.provider]: "" })); await refresh(); } });
  const clear = api.settings.credentials.clear.useMutation({ onSuccess: refresh });
  const test = api.settings.credentials.test.useMutation({ onSuccess: (report, input) => setReports((r) => ({ ...r, [input.provider]: report })) });
  const busy = save.isPending || clear.isPending;

  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-sm text-muted">Keys are encrypted in your database and never shown again. Your provider bills each render; Troupe takes no payment.</p>
      {ACCOUNTS.map((account) => {
        const s = status.data?.[account.id];
        return (
          <form key={account.id} className="space-y-2 border-b border-muted/20 pb-5" onSubmit={(event) => { event.preventDefault(); save.mutate({ provider: account.id, key: keys[account.id] }); }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <label htmlFor={`key-${account.id}`} className="text-sm font-medium">{account.name} API key</label>
              <span className={`text-xs ${s?.source === "undecryptable" ? "text-warning" : "text-muted"}`}>{s ? SOURCE_LABEL[s.source] : "Loading…"}</span>
            </div>
            <p className="text-xs text-muted">{account.models}</p>
            <div className="flex flex-wrap gap-2">
              <input id={`key-${account.id}`} type="password" autoComplete="off" spellCheck={false} value={keys[account.id]} onChange={(event) => setKeys((old) => ({ ...old, [account.id]: event.target.value }))} placeholder={s?.configured ? "Paste a replacement key" : "Paste your API key"} className="min-w-0 flex-1 rounded-lg border border-muted/40 bg-bg px-3 py-2 text-sm" />
              <button type="submit" disabled={busy || !keys[account.id].trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90 disabled:opacity-40">{save.isPending && save.variables?.provider === account.id ? "Saving…" : "Save key"}</button>
              {s?.configured ? <button type="button" disabled={busy || test.isPending} onClick={() => test.mutate({ provider: account.id })} className="rounded-lg border border-muted/30 px-3 py-2 text-sm disabled:opacity-40">{test.isPending && test.variables?.provider === account.id ? "Testing…" : "Test"}</button> : null}
              {s?.source === "saved" || s?.source === "undecryptable" ? <button type="button" disabled={busy} onClick={() => clear.mutate({ provider: account.id, mode: "remove" })} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-fg disabled:opacity-40">Remove</button> : null}
              {s?.source === "environment" ? <button type="button" disabled={busy} onClick={() => clear.mutate({ provider: account.id, mode: "disable" })} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-fg disabled:opacity-40">Turn off</button> : null}
              {s?.source === "disabled" ? <button type="button" disabled={busy} onClick={() => clear.mutate({ provider: account.id, mode: "remove" })} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-fg disabled:opacity-40">Turn back on</button> : null}
            </div>
            <ConnectionResult report={reports[account.id]} />
            <a href={account.href} target="_blank" rel="noreferrer" className="inline-block py-1 text-xs text-primary hover:underline">Get a {account.name} key ↗</a>
          </form>
        );
      })}
      {status.error ?? save.error ?? clear.error ?? test.error ? <ErrorNote>{(status.error ?? save.error ?? clear.error ?? test.error)!.message}</ErrorNote> : null}
    </div>
  );
}
