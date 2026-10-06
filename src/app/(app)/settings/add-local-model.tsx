"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { ErrorNote, ProviderWarning, buttonClass, chipClass, fieldClass, fieldSurface, panelClass } from "~/app/_components/ui";
import { ConnectionResult, type Report } from "./connection-result";

const ASPECTS = ["9:16", "16:9", "1:1"] as const;
const RESOLUTIONS = ["480p", "540p", "576p", "720p", "1080p"] as const;

export interface TemplateView {
  id: string;
  label: string;
  description: string;
  vramGb: number;
  verification: "rendered" | "contract";
  comfyuiVersion: string;
  requiredFiles: { folder: string; filename: string; url?: string }[];
}

export interface CapabilitiesDraft {
  aspectRatios: (typeof ASPECTS)[number][];
  resolutions: (typeof RESOLUTIONS)[number][];
  durationsS: number[];
  audio: "always" | "optional" | "none";
  dialogueLanguages: string[] | null;
}

export type LocalModelDraft =
  | { family: "http"; label: string; baseUrl: string; token?: string; capabilities: CapabilitiesDraft; fps?: number }
  | { family: "comfyui"; label: string; baseUrl: string; token?: string; templateId?: string; workflow?: unknown; capabilities?: CapabilitiesDraft; fps?: number; frameRule?: "any" | "4n+1" | "8n+1" };

const DEFAULT_CAPS: CapabilitiesDraft = { aspectRatios: ["16:9", "9:16"], resolutions: ["720p"], durationsS: [5], audio: "none", dialogueLanguages: null };

function parseDurations(text: string) {
  const values = text.split(/[\s,]+/).filter(Boolean).map(Number);
  return values.length && values.every((v) => Number.isInteger(v) && v >= 1 && v <= 60) ? [...new Set(values)].sort((a, b) => a - b) : null;
}

function CapabilitiesFields({ value, onChange }: { value: CapabilitiesDraft; onChange: (caps: CapabilitiesDraft) => void }) {
  const [durations, setDurations] = useState(value.durationsS.join(", "));
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-1 text-sm font-medium">What it can render</legend>
      <div className="text-sm">
        <span className="mb-1.5 block font-medium">Formats</span>
        {ASPECTS.map((a) => (
          <label key={a} className="mr-3 inline-flex items-center gap-1"><input type="checkbox" checked={value.aspectRatios.includes(a)} onChange={() => onChange({ ...value, aspectRatios: toggle(value.aspectRatios, a) })} />{a}</label>
        ))}
      </div>
      <div className="text-sm">
        <span className="mb-1.5 block font-medium">Resolutions</span>
        {RESOLUTIONS.map((r) => (
          <label key={r} className="mr-3 inline-flex items-center gap-1"><input type="checkbox" checked={value.resolutions.includes(r)} onChange={() => onChange({ ...value, resolutions: toggle(value.resolutions, r) })} />{r}</label>
        ))}
      </div>
      <label className="text-sm">
        <span className="mb-1.5 block font-medium">Clip lengths (seconds)</span>
        <input value={durations} onChange={(e) => { setDurations(e.target.value); const parsed = parseDurations(e.target.value); if (parsed) onChange({ ...value, durationsS: parsed }); }} placeholder="4, 5, 8" className={fieldClass} />
      </label>
      <label className="text-sm">
        <span className="mb-1.5 block font-medium">Audio</span>
        <select value={value.audio} onChange={(e) => onChange({ ...value, audio: e.target.value as CapabilitiesDraft["audio"] })} data-field className={fieldClass}>
          <option value="none">Silent video</option>
          <option value="optional">Audio on request</option>
          <option value="always">Always with audio</option>
        </select>
      </label>
    </fieldset>
  );
}

// Pure view — the "add a local model" form: ComfyUI (template or imported
// workflow) or a generic HTTP endpoint. Test before saving. comfyUrl is where
// the server expects ComfyUI to answer from where Troupe runs.
export function AddLocalModelForm({ templates, comfyUrl, busy, report, error, onTest, onSave }: {
  templates: TemplateView[];
  comfyUrl: string;
  busy?: boolean;
  report?: Report;
  error?: string | null;
  onTest: (draft: LocalModelDraft) => void;
  onSave: (draft: LocalModelDraft) => void;
}) {
  const [family, setFamily] = useState<"comfyui" | "http">("comfyui");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState(comfyUrl);
  const [token, setToken] = useState("");
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? "custom");
  const [workflow, setWorkflow] = useState<unknown>(undefined);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [caps, setCaps] = useState<CapabilitiesDraft>(DEFAULT_CAPS);
  const [fps, setFps] = useState("24");
  const [frameRule, setFrameRule] = useState<"any" | "4n+1" | "8n+1">("any");
  const template = templates.find((t) => t.id === templateId);
  const custom = family === "comfyui" && !template;

  function draft(): LocalModelDraft {
    const common = { label: label.trim() || (template?.label ?? "Local model"), baseUrl: baseUrl.trim(), ...(token.trim() ? { token: token.trim() } : {}) };
    if (family === "http") return { family, ...common, capabilities: caps, fps: Number(fps) || undefined };
    if (template) return { family, ...common, templateId: template.id };
    return { family, ...common, workflow, capabilities: caps, fps: Number(fps) || undefined, frameRule };
  }

  async function importWorkflow(file: File | undefined) {
    setWorkflowError(null);
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setWorkflowError("The workflow is larger than 2 MB."); return; }
    try {
      setWorkflow(JSON.parse(await file.text()));
    } catch {
      setWorkflowError("This file is not valid JSON.");
    }
  }

  const ready = baseUrl.trim() && (!custom || workflow !== undefined) && caps.aspectRatios.length && caps.resolutions.length;
  return (
    <form className={`max-w-2xl space-y-5 px-4 py-5 sm:px-5 ${panelClass}`} onSubmit={(e) => { e.preventDefault(); if (ready) onSave(draft()); }}>
      <fieldset className="flex gap-2">
        <legend className="mb-2 text-sm font-medium">Kind</legend>
        {(["comfyui", "http"] as const).map((f) => (
          <label key={f} className={chipClass(family === f)}>
            <input type="radio" name="family" className="sr-only" checked={family === f} onChange={() => { setFamily(f); setBaseUrl(f === "comfyui" ? comfyUrl : ""); }} />
            {f === "comfyui" ? "ComfyUI" : "HTTP endpoint"}
          </label>
        ))}
      </fieldset>

      {family === "comfyui" ? (
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Workflow</span>
          <select aria-label="Workflow" value={templateId} onChange={(e) => setTemplateId(e.target.value)} data-field className={fieldClass}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            <option value="custom">Import my own workflow (API format)…</option>
          </select>
        </label>
      ) : null}
      {template ? (
        <div className="space-y-2 text-xs text-muted">
          <p>{template.description}</p>
          <p>Needs about {template.vramGb} GB of GPU memory. Checked against ComfyUI {template.comfyuiVersion}{template.verification === "contract" ? " (graph validated; not yet rendered end to end)" : ""}.</p>
          <details>
            <summary className="cursor-pointer text-primary">Model files to download into ComfyUI</summary>
            <ul className="mt-1 list-disc pl-5">
              {template.requiredFiles.map((f) => <li key={f.filename}>models/{f.folder}/{f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{f.filename}</a> : f.filename}</li>)}
            </ul>
          </details>
        </div>
      ) : null}
      {custom ? (
        <div className="space-y-2">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">API workflow file</span>
            <input type="file" accept="application/json,.json" onChange={(e) => void importWorkflow(e.target.files?.[0])} className="text-sm" />
          </label>
          <p className="text-xs text-muted">In ComfyUI use Workflow → Export (API). Put {"{{prompt}}"}, {"{{width}}"}, {"{{height}}"}, {"{{frames}}"}, {"{{seed}}"} and {"{{filename_prefix}}"} in the inputs Troupe should fill, and save the result as an MP4.</p>
          {workflowError ? <ErrorNote>{workflowError}</ErrorNote> : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Name</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={template?.label ?? "My GPU box"} maxLength={80} className={fieldClass} />
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Address</span>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://192.168.1.20:8000" className={`${fieldSurface} w-full bg-surface px-3 py-2 font-mono text-xs`} />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1.5 block font-medium">Token (optional)</span>
          <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Sent as a Bearer token to this address only" className={fieldClass} />
        </label>
      </div>
      {family === "comfyui" ? (
        <p className="text-xs text-muted">ComfyUI Desktop listens on port 8000, ComfyUI started from the command line on 8188. When Troupe runs in Docker, write host.docker.internal instead of 127.0.0.1; with the compose <code>comfyui</code> profile the address is http://comfyui:8188.</p>
      ) : null}

      {family === "http" || custom ? (
        <>
          <CapabilitiesFields value={caps} onChange={setCaps} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Frames per second</span>
              <input inputMode="numeric" value={fps} onChange={(e) => setFps(e.target.value)} className={fieldClass} />
            </label>
            {custom ? (
              <label className="text-sm">
                <span className="mb-1.5 block font-medium">Frame count rule</span>
                <select value={frameRule} onChange={(e) => setFrameRule(e.target.value as typeof frameRule)} data-field className={fieldClass}>
                  <option value="any">Any (seconds × fps)</option>
                  <option value="4n+1">4n+1 (Wan)</option>
                  <option value="8n+1">8n+1 (LTX)</option>
                </select>
              </label>
            ) : null}
          </div>
          {caps.audio === "none" ? <ProviderWarning>Silent models make the actor mime the script; add the voice in your editor.</ProviderWarning> : null}
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !ready} onClick={() => onTest(draft())} className={buttonClass()}>Test</button>
        <button type="submit" disabled={busy || !ready} className={buttonClass({ variant: "primary" })}>Add model</button>
      </div>
      <ConnectionResult report={report} />
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </form>
  );
}

export function AddLocalModel() {
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<Report | undefined>();
  // The draft the report is about: its polling pace is only kept for it.
  const [tested, setTested] = useState<string | null>(null);
  const templates = api.settings.models.templates.useQuery(undefined, { enabled: open });
  const suggested = api.settings.models.suggestedAddress.useQuery(undefined, { enabled: open });
  const test = api.settings.models.testDraft.useMutation({ onSuccess: setReport, onMutate: () => setReport({ ok: null, message: "Testing…" }) });
  const create = api.settings.models.createLocal.useMutation({
    onSuccess: async () => {
      setOpen(false);
      setReport(undefined);
      setTested(null);
      await Promise.all([utils.settings.models.list.invalidate(), utils.studio.modelOptions.invalidate()]);
    },
  });
  if (!open) {
    return (
      <div className="space-y-2">
        <p className="max-w-[72ch] text-sm text-muted">Run video models on your own GPU through ComfyUI or any server that follows Troupe&apos;s small HTTP contract (see docs/LOCAL-MODELS.md). Local renders cost nothing per clip.</p>
        <button type="button" onClick={() => setOpen(true)} className={buttonClass()}>Add a local model</button>
      </div>
    );
  }
  if (templates.isPending || suggested.isPending) return <p className="text-sm text-muted">Loading templates…</p>;
  return (
    <AddLocalModelForm
      templates={(templates.data ?? []) as TemplateView[]}
      comfyUrl={suggested.data?.comfyui ?? "http://127.0.0.1:8188"}
      busy={test.isPending || create.isPending}
      report={report}
      error={(templates.error ?? create.error ?? test.error)?.message ?? null}
      onTest={(draft) => {
        setTested(JSON.stringify(draft));
        test.mutate(draft as Parameters<typeof test.mutate>[0]);
      }}
      onSave={(draft) => {
        const pollEveryS = draft.family === "http" && report?.ok && tested === JSON.stringify(draft) ? report.pollEveryS : undefined;
        create.mutate({ ...draft, ...(pollEveryS ? { pollEveryS } : {}) } as Parameters<typeof create.mutate>[0]);
      }}
    />
  );
}
