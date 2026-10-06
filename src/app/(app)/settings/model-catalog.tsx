"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { useEdition } from "~/app/_components/edition";
import { ErrorNote, SkeletonRows, buttonClass, fieldClass, panelClass } from "~/app/_components/ui";
import { ConnectionResult, type Report } from "./connection-result";

export interface CatalogModelView {
  key: string;
  label: string;
  vendor: string;
  kind: "cloud" | "local";
  capabilities: { resolutions: string[]; durationsS: number[]; audio: "always" | "optional" | "none" };
  defaults: { resolution: string; durationS: number; audio: boolean };
  pricePerSecondUsd: number | null;
  timeoutS: number;
  enabled: boolean;
  archived: boolean;
  status: string;
  statusDetail: string | null;
  // The provider account a cloud model needs (null for local models).
  credential?: "google" | "fal" | null;
  // Local models only: where it lives (never the token).
  connection?: { baseUrl: string; hasToken: boolean };
}

export interface ModelPreferencesInput {
  defaults: { resolution: string; durationS: number; audio: boolean };
  pricePerSecondUsd: number | null;
  timeoutS: number;
}

const CREDENTIAL_NAMES = { google: "Google AI", fal: "fal.ai" } as const;

const launchable = (m: CatalogModelView) => m.status === "ready" && m.enabled && !m.archived;

// Pure view — the studio-wide default model.
export function DefaultModelPicker({ models, savedKey, effectiveKey, busy, noModelHint = "No model can launch yet. Add an API key or a local model below.", onChange }: {
  models: CatalogModelView[];
  savedKey: string | null;
  effectiveKey: string | null;
  busy?: boolean;
  // What to say when nothing can launch.
  noModelHint?: string;
  onChange: (modelKey: string | null) => void;
}) {
  const effective = models.find((m) => m.key === effectiveKey);
  return (
    <div className="max-w-md space-y-2">
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Default model for new launches</span>
        <select aria-label="Default model" value={savedKey ?? ""} disabled={busy} onChange={(e) => onChange(e.target.value || null)} data-field className={fieldClass}>
          <option value="">Automatic (first available)</option>
          {models.filter(launchable).map((m) => <option key={m.key} value={m.key}>{m.label} · {m.kind}</option>)}
        </select>
      </label>
      <p className="text-xs text-muted">
        {effective ? `New projects launch on ${effective.label} unless you pick another model.` : noModelHint}
        {savedKey && savedKey !== effectiveKey ? " Your saved default is unavailable, so the first available model is used." : ""}
      </p>
    </div>
  );
}

// Pure view — one row per model: status, on/off, test, and its launch defaults.
export function ModelCatalogList({ models, reports, busy, onToggle, onTest, onSave, onArchive, onEditConnection }: {
  models: CatalogModelView[];
  reports: Record<string, Report | undefined>;
  busy?: boolean;
  onToggle: (modelKey: string, enabled: boolean) => void;
  onTest: (modelKey: string) => void;
  onSave: (modelKey: string, prefs: ModelPreferencesInput) => void;
  onArchive?: (modelKey: string, archived: boolean) => void;
  onEditConnection?: (modelKey: string, change: ConnectionChange) => void;
}) {
  return (
    <ul className="max-w-3xl space-y-3">
      {models.map((m) => (
        <li key={m.key} className={`px-4 py-4 sm:px-5 ${panelClass} ${m.archived ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{m.label}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${m.kind === "local" ? "bg-success/15 text-success" : "bg-fg/[0.07] text-muted"}`}>{m.kind}</span>
                <span className="text-xs text-muted">{m.vendor}</span>
              </p>
              <p className={`mt-0.5 text-xs ${m.status === "ready" ? "text-muted" : "text-warning"}`}>
                {m.archived ? "Archived" : m.status === "ready" ? (m.enabled ? "Ready" : "Turned off") : m.status === "missing-credentials" && m.credential ? (
                  // This page holds the key form: point to it, not to "Settings".
                  <>Add a {CREDENTIAL_NAMES[m.credential]} key under <a href="#provider-accounts" className="underline underline-offset-2">Provider accounts</a> below.</>
                ) : m.statusDetail}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Nothing to test where the model cannot run: its status already says why. */}
              {m.status !== "unsupported-host" ? (
                <button type="button" disabled={busy} onClick={() => onTest(m.key)} className={buttonClass({ size: "sm" })}>Test</button>
              ) : null}
              {!m.archived ? (
                <label className="flex min-h-9 items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-[var(--troupe-color-primary)]" role="switch" aria-checked={m.enabled} aria-label={`Use ${m.label}`} checked={m.enabled} disabled={busy} onChange={(e) => onToggle(m.key, e.target.checked)} />
                  On
                </label>
              ) : null}
              {m.kind === "local" && onArchive ? (
                <button type="button" disabled={busy} onClick={() => onArchive(m.key, !m.archived)} className={buttonClass({ variant: "quiet", size: "sm" })}>{m.archived ? "Restore" : "Archive"}</button>
              ) : null}
            </div>
          </div>
          <ConnectionResult report={reports[m.key]} />
          {m.connection && onEditConnection && !m.archived ? (
            <LocalConnectionForm connection={m.connection} label={m.label} busy={busy} onSave={(change) => onEditConnection(m.key, change)} />
          ) : null}
          {!m.archived ? <ModelPreferencesForm model={m} busy={busy} onSave={(prefs) => onSave(m.key, prefs)} /> : null}
        </li>
      ))}
    </ul>
  );
}

export interface ConnectionChange {
  label?: string;
  baseUrl?: string;
  token?: string;
  clearToken?: boolean;
}

function LocalConnectionForm({ connection, label, busy, onSave }: { connection: { baseUrl: string; hasToken: boolean }; label: string; busy?: boolean; onSave: (change: ConnectionChange) => void }) {
  const [name, setName] = useState(label);
  const [baseUrl, setBaseUrl] = useState(connection.baseUrl);
  const [token, setToken] = useState("");
  return (
    <details className="mt-2">
      <summary className="inline-flex min-h-9 cursor-pointer items-center text-sm font-medium text-primary">Name, address and token</summary>
      <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...(name.trim() !== label ? { label: name.trim() } : {}), ...(baseUrl.trim() !== connection.baseUrl ? { baseUrl: baseUrl.trim() } : {}), ...(token.trim() ? { token: token.trim() } : {}) });
        setToken("");
      }}>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={fieldClass} />
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Address</span>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={`${fieldClass} font-mono text-xs`} />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1.5 block font-medium">Token</span>
          <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={connection.hasToken ? "Saved — paste a replacement to change it" : "None"} className={fieldClass} />
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button type="submit" disabled={busy || !name.trim() || !baseUrl.trim()} className={buttonClass({ variant: "primary" })}>Save</button>
          {connection.hasToken ? <button type="button" disabled={busy} onClick={() => onSave({ clearToken: true })} className={buttonClass({ variant: "quiet" })}>Remove token</button> : null}
        </div>
      </form>
    </details>
  );
}

function ModelPreferencesForm({ model, busy, onSave }: { model: CatalogModelView; busy?: boolean; onSave: (prefs: ModelPreferencesInput) => void }) {
  const [resolution, setResolution] = useState(model.defaults.resolution);
  const [durationS, setDurationS] = useState(model.defaults.durationS);
  const [audio, setAudio] = useState(model.defaults.audio);
  const [price, setPrice] = useState(model.pricePerSecondUsd === null ? "" : String(model.pricePerSecondUsd));
  const [timeoutMin, setTimeoutMin] = useState(String(Math.round(model.timeoutS / 60)));
  const priceValue = price.trim() === "" ? null : Number(price);
  const timeoutValue = Number(timeoutMin);
  const valid = (priceValue === null || (Number.isFinite(priceValue) && priceValue >= 0)) && Number.isInteger(timeoutValue) && timeoutValue >= 1 && timeoutValue <= 1440;
  return (
    <details className="mt-2">
      <summary className="inline-flex min-h-9 cursor-pointer items-center text-sm font-medium text-primary">Launch defaults and limits</summary>
      <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (valid) onSave({ defaults: { resolution, durationS, audio }, pricePerSecondUsd: priceValue, timeoutS: timeoutValue * 60 }); }}>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Resolution</span>
          <select value={resolution} onChange={(e) => setResolution(e.target.value)} data-field className={fieldClass}>
            {model.capabilities.resolutions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Length</span>
          <select value={durationS} onChange={(e) => setDurationS(Number(e.target.value))} data-field className={fieldClass}>
            {model.capabilities.durationsS.map((d) => <option key={d} value={d}>{d} s</option>)}
          </select>
          <span className="mt-1 block text-xs text-muted">Launch and Compare start on it whenever the script fits; a longer script gets the shortest clip that holds it.</span>
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Price per second (USD)</span>
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={model.kind === "local" ? "0 — runs locally" : "Unknown — check your provider"} className={fieldClass} />
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Give up after (minutes)</span>
          <input inputMode="numeric" value={timeoutMin} onChange={(e) => setTimeoutMin(e.target.value)} className={fieldClass} />
        </label>
        {model.capabilities.audio === "optional" ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
            Generate audio by default
          </label>
        ) : <p className="text-xs text-muted">{model.capabilities.audio === "always" ? "This model always generates audio." : "This model makes silent video."}</p>}
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy || !valid} className={buttonClass({ variant: "primary" })}>Save</button>
          {!valid ? <span className="ml-3 text-xs text-warning">Enter a price of 0 or more and a limit between 1 and 1440 minutes.</span> : null}
        </div>
      </form>
    </details>
  );
}

// Container — wires the catalog views to the settings router.
export function ModelCatalogSettings({ kind }: { kind: "cloud" | "local" }) {
  const utils = api.useUtils();
  const list = api.settings.models.list.useQuery();
  const [reports, setReports] = useState<Record<string, Report | undefined>>({});
  const refresh = () => Promise.all([utils.settings.models.list.invalidate(), utils.studio.modelOptions.invalidate()]);
  const update = api.settings.models.update.useMutation({ onSuccess: refresh });
  const test = api.settings.models.test.useMutation({ onSuccess: (report, input) => setReports((r) => ({ ...r, [input.modelKey]: report })) });
  const archive = api.settings.models.archive.useMutation({ onSuccess: refresh });
  const connections = api.settings.models.connections.useQuery(undefined, { enabled: kind === "local" });
  const editConnection = api.settings.models.updateLocal.useMutation({ onSuccess: () => Promise.all([refresh(), utils.settings.models.connections.invalidate()]) });
  if (list.isPending) return <SkeletonRows rows={3} />;
  if (list.error) return <ErrorNote>The model list could not be loaded: {list.error.message}</ErrorNote>;
  const byKey = new Map((connections.data ?? []).map((c) => [c.modelKey, c]));
  const models = (list.data.models as CatalogModelView[])
    .filter((m) => m.kind === kind)
    .map((m) => ({ ...m, connection: byKey.get(m.key) }));
  if (models.length === 0) return null;
  const error = update.error ?? test.error ?? archive.error ?? editConnection.error;
  return (
    <>
      <ModelCatalogList
        models={models}
        reports={reports}
        busy={update.isPending || archive.isPending || editConnection.isPending}
        onToggle={(modelKey, enabled) => update.mutate({ modelKey, enabled })}
        onTest={(modelKey) => { setReports((r) => ({ ...r, [modelKey]: { ok: null, message: "Testing…" } })); test.mutate({ modelKey }); }}
        onSave={(modelKey, prefs) => update.mutate({ modelKey, ...prefs })}
        onArchive={(modelKey, archived) => archive.mutate({ modelKey, archived })}
        onEditConnection={(modelKey, change) => editConnection.mutate({ modelKey, ...change })}
      />
      {error ? <ErrorNote>{error.message}</ErrorNote> : null}
    </>
  );
}

export function DefaultModelSettings() {
  const browser = useEdition().kind === "browser";
  const utils = api.useUtils();
  const list = api.settings.models.list.useQuery();
  const setDefault = api.settings.models.setDefault.useMutation({
    onSuccess: () => Promise.all([utils.settings.models.list.invalidate(), utils.studio.modelOptions.invalidate()]),
  });
  if (list.isPending) return <SkeletonRows rows={1} />;
  if (list.error) return <ErrorNote>{list.error.message}</ErrorNote>;
  return (
    <>
      <DefaultModelPicker
        models={list.data.models as CatalogModelView[]}
        savedKey={list.data.savedDefaultModelKey}
        effectiveKey={list.data.defaultModelKey}
        busy={setDefault.isPending}
        noModelHint={browser ? "No model can render in this browser. Kokoro voice + captions, under Local models, says why." : undefined}
        onChange={(modelKey) => setDefault.mutate({ modelKey })}
      />
      {setDefault.error ? <ErrorNote>{setDefault.error.message}</ErrorNote> : null}
    </>
  );
}
