"use client";

import { errorText } from "~/app/_components/errors";
import { useEffect, useState } from "react";

import { api } from "~/trpc/react";
import { ErrorNote, ProviderWarning, Skeleton, buttonClass, fieldClass } from "~/app/_components/ui";
import { ConnectionResult, type Report } from "./connection-result";

type Provider = "auto" | "ollama" | "anthropic" | "openrouter" | "webllm";

interface Draft {
  provider: Provider;
  ollamaUrl: string;
  ollamaModel: string;
  anthropicModel: string;
  openrouterModel: string;
  instructions: string;
  wordsPerSecond: string;
}

const PROVIDER_LABELS: Record<Exclude<Provider, "auto">, string> = {
  ollama: "Ollama, on this machine or your network",
  anthropic: "Claude, with your Anthropic key",
  openrouter: "OpenRouter, with your OpenRouter key",
  webllm: "This browser's model, on your GPU",
};

// "Automatic" says what it picks in this edition.
function autoLabel(offers: string[]): string {
  return offers.includes("ollama")
    ? "Automatic: Claude with an Anthropic key, else OpenRouter with an OpenRouter key, else Ollama"
    : "Automatic: OpenRouter when its key is saved, else this browser's model";
}

const field = fieldClass;

// The script chat: who answers, and the house style it writes in. Blank
// fields use the default shown as their placeholder (from the environment
// in the self-hosted studio, from the build in the browser edition).
export function ChatSettings() {
  const utils = api.useUtils();
  const view = api.settings.chat.get.useQuery();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [report, setReport] = useState<Report | undefined>();
  const save = api.settings.chat.save.useMutation({
    onSuccess: async (next) => {
      utils.settings.chat.get.setData(undefined, next);
      setReport(undefined);
      await utils.chat.history.invalidate();
    },
  });
  const test = api.settings.chat.test.useMutation({ onSuccess: setReport });

  useEffect(() => {
    if (!view.data || draft) return;
    const s = view.data.saved;
    setDraft({
      provider: s.provider ?? "auto",
      ollamaUrl: s.ollamaUrl ?? "",
      ollamaModel: s.ollamaModel ?? "",
      anthropicModel: s.anthropicModel ?? "",
      openrouterModel: s.openrouterModel ?? "",
      instructions: s.instructions ?? "",
      wordsPerSecond: s.wordsPerSecond?.toString() ?? "",
    });
  }, [view.data, draft]);

  if (view.isPending) return <Skeleton className="h-40 w-full max-w-2xl" />;
  if (view.error) return <ErrorNote>The chat settings could not be loaded: {errorText(view.error)}</ErrorNote>;
  if (!draft) return null;

  const { offers, defaults, active } = view.data;
  const self = offers.includes("ollama");
  const choices: Provider[] = ["auto", ...offers];
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const rate = draft.wordsPerSecond.trim() ? Number(draft.wordsPerSecond) : null;
  const rateProblem = rate !== null && !(rate >= 1 && rate <= 5) ? "Use a number from 1 to 5." : null;
  const example = Math.floor(8 * (rate && !rateProblem ? rate : defaults.wordsPerSecond));

  return (
    <form
      className="max-w-2xl space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (rateProblem) return;
        save.mutate({
          provider: draft.provider === "auto" ? null : draft.provider,
          ...(self
            ? {
                ollamaUrl: draft.ollamaUrl,
                ollamaModel: draft.ollamaModel,
                anthropicModel: draft.anthropicModel,
              }
            : {}),
          ...(offers.includes("openrouter") ? { openrouterModel: draft.openrouterModel } : {}),
          instructions: draft.instructions,
          wordsPerSecond: rate,
        });
      }}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-sm">
            <span className="text-muted">Answering now:</span> {active.label}{" "}
            <span className="font-mono text-xs text-muted">{active.modelId}</span>
          </p>
          <button
            type="button"
            disabled={test.isPending}
            onClick={() => test.mutate({ provider: active.provider })}
            className={buttonClass({ size: "sm" })}
          >
            {test.isPending ? "Testing…" : "Test"}
          </button>
        </div>
        {active.problem ? <ProviderWarning>{active.problem}</ProviderWarning> : null}
        <ConnectionResult report={report} />
      </div>

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Model provider</span>
        <select
          data-field
          value={choices.includes(draft.provider) ? draft.provider : "auto"}
          onChange={(e) => set({ provider: e.target.value as Provider })}
          className={field}
        >
          {choices.map((id) => (
            <option key={id} value={id}>
              {id === "auto" ? autoLabel(offers) : PROVIDER_LABELS[id]}
            </option>
          ))}
        </select>
      </label>

      {offers.includes("openrouter") ? (
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">OpenRouter model</span>
          <input
            value={draft.openrouterModel}
            onChange={(e) => set({ openrouterModel: e.target.value })}
            placeholder={defaults.openrouterModel}
            spellCheck={false}
            className={`${field} font-mono sm:max-w-sm`}
          />
          <span className="mt-1 block text-xs text-muted">
            Any OpenRouter model with structured outputs. The key goes under Provider accounts; OpenRouter bills each
            message (a few tenths of a cent with the default).
          </span>
        </label>
      ) : null}

      {self ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">Ollama address</span>
              <input
                value={draft.ollamaUrl}
                onChange={(e) => set({ ollamaUrl: e.target.value })}
                placeholder={defaults.ollamaUrl}
                spellCheck={false}
                className={`${field} font-mono`}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">Ollama model</span>
              <input
                value={draft.ollamaModel}
                onChange={(e) => set({ ollamaModel: e.target.value })}
                placeholder={defaults.ollamaModel}
                spellCheck={false}
                className={`${field} font-mono`}
              />
            </label>
          </div>
          <p className="-mt-2 text-xs text-muted">
            Pull the model first:{" "}
            <code className="font-mono">ollama pull {draft.ollamaModel.trim() || defaults.ollamaModel}</code>. Any model
            that follows a JSON schema works.
          </p>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Claude model</span>
            <input
              value={draft.anthropicModel}
              onChange={(e) => set({ anthropicModel: e.target.value })}
              placeholder={defaults.anthropicModel}
              spellCheck={false}
              className={`${field} font-mono sm:max-w-xs`}
            />
            <span className="mt-1 block text-xs text-muted">
              The key goes under Provider accounts. Anthropic bills each message.
            </span>
          </label>
        </>
      ) : (
        <p className="max-w-[72ch] text-sm text-muted">
          In your browser the chat answers through OpenRouter with your key, called from this page, or runs{" "}
          <span className="font-mono text-xs text-fg">{defaults.webllmModel}</span> in this tab, on your GPU through
          WebGPU. Ollama and Claude need the self-hosted studio.
        </p>
      )}

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">House style</span>
        <textarea
          value={draft.instructions}
          onChange={(e) => set({ instructions: e.target.value })}
          rows={3}
          maxLength={2000}
          placeholder={defaults.instructions || "Warm and direct. Short sentences, no exclamation marks."}
          className={`${field} resize-y`}
        />
        <span className="mt-1 block text-xs text-muted">
          Added to every request: tone, words to avoid, how to sign off.
        </span>
      </label>

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Words per second</span>
        <input
          type="number"
          inputMode="decimal"
          min={1}
          max={5}
          step={0.1}
          value={draft.wordsPerSecond}
          onChange={(e) => set({ wordsPerSecond: e.target.value })}
          placeholder={String(defaults.wordsPerSecond)}
          className={`${field} font-mono tabular-nums sm:max-w-[8rem]`}
          aria-describedby="chat-rate-hint"
        />
        <span id="chat-rate-hint" className={`mt-1 block text-xs ${rateProblem ? "text-danger" : "text-muted"}`}>
          {rateProblem ?? `The chat's word budget: an 8 s clip allows ${example} words. Lower it for a slower voice.`}
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending || Boolean(rateProblem)}
          className={buttonClass({ variant: "primary" })}
        >
          {save.isPending ? "Saving…" : "Save chat settings"}
        </button>
        {save.isSuccess && !save.isPending ? (
          <span role="status" className="text-xs text-success">
            Saved.
          </span>
        ) : null}
      </div>
      {save.error ? <ErrorNote>{errorText(save.error)}</ErrorNote> : null}
      {test.error ? <ErrorNote>{errorText(test.error)}</ErrorNote> : null}
    </form>
  );
}
