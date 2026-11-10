"use client";

import Link from "next/link";
import { useState } from "react";

import { errorText } from "~/app/_components/errors";
import { Button, ErrorNote, ProviderWarning, Skeleton, fieldClass } from "~/app/_components/ui";
import { api } from "~/trpc/react";

const AGES = ["18-24", "25-34", "35-44", "45-54", "55+"];

// Examples a first actor can start from: one click fills the form.
export const ACTOR_EXAMPLES = [
  {
    label: "Skincare creator",
    name: "Maya",
    gender: "female" as const,
    ageRange: "25-34",
    style: "casual",
    look: "Warm brown skin, dark curly hair in a loose bun, light freckles, small gold hoops, oversized cream knit sweater, natural make-up.",
    voiceProfile: "warm and enthusiastic, mid-tempo",
  },
  {
    label: "Tech reviewer",
    name: "Theo",
    gender: "male" as const,
    ageRange: "25-34",
    style: "streetwear",
    look: "Short black hair with a fade, trimmed beard, round glasses, charcoal hoodie, a small silver chain.",
    voiceProfile: "calm and confident, low register",
  },
  {
    label: "Local bakery owner",
    name: "Hélène",
    gender: "female" as const,
    ageRange: "45-54",
    style: "cozy",
    look: "Shoulder-length grey-blond hair, laugh lines, flour on her navy apron over a striped shirt, reading glasses on her head.",
    voiceProfile: "measured and trustworthy",
  },
];

type Draft = Omit<(typeof ACTOR_EXAMPLES)[number], "label">;

const EMPTY: Draft = { name: "", gender: "female", ageRange: "25-34", style: "", look: "", voiceProfile: "" };

// Make a new actor from a description: six pictures of the same synthetic
// person, drawn on the visitor's own OpenRouter key.
export function CreateActor({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [modelKey, setModelKey] = useState<string | undefined>();
  const utils = api.useUtils();
  const options = api.actors.createOptions.useQuery({ workspaceId }, { enabled: open });
  const create = api.actors.create.useMutation({
    onSuccess: async () => {
      setDraft(EMPTY);
      await utils.actors.list.invalidate();
      await utils.actors.createOptions.invalidate();
    },
  });
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  if (!open)
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        Create an actor
      </Button>
    );

  const models = options.data?.models ?? [];
  const chosen = models.find((m) => m.key === modelKey) ?? models.find((m) => m.available);
  const cost = chosen?.estimatedCostUsd;
  const ready = draft.name.trim() && draft.style.trim() && draft.look.trim().length >= 10 && draft.voiceProfile.trim();
  const canDraw = options.data?.openrouterKey || models.some((m) => m.available);

  return (
    <form
      className="max-w-2xl space-y-4 rounded-2xl bg-raised p-5 shadow-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || create.isPending) return;
        create.mutate({ workspaceId, ...draft, ...(chosen ? { modelKey: chosen.key } : {}) });
      }}
    >
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-display text-lg font-semibold">Create an actor</h3>
        <button type="button" className="text-sm text-muted underline" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <p className="text-sm text-muted">
        Describe a person who does not exist. A photo model draws their front portrait, then the five other pictures of
        the set (two side views, three expressions) from it, so the face stays the same. Video models then start from
        that portrait, and talking-photo models make it speak.
      </p>

      {options.isPending ? (
        <Skeleton className="h-6 w-1/2" />
      ) : options.error ? (
        <ErrorNote>{errorText(options.error)}</ErrorNote>
      ) : !canDraw ? (
        <ProviderWarning>
          Making an actor needs an OpenRouter key.{" "}
          <Link href="/settings#provider-accounts" className="underline">
            Add it in Settings
          </Link>
          , then come back.
        </ProviderWarning>
      ) : null}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Start from an example">
        {ACTOR_EXAMPLES.map(({ label, ...example }) => (
          <button
            key={label}
            type="button"
            className="rounded-full bg-surface px-3 py-1 text-xs shadow-card hover:bg-fg/5"
            onClick={() => set(example)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          Name
          <input
            className={`${fieldClass} mt-1`}
            value={draft.name}
            maxLength={60}
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          Style
          <input
            className={`${fieldClass} mt-1`}
            value={draft.style}
            maxLength={40}
            placeholder="casual, formal, sporty…"
            onChange={(e) => set({ style: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          Gender
          <select
            className={`${fieldClass} mt-1`}
            value={draft.gender}
            onChange={(e) => set({ gender: e.target.value as Draft["gender"] })}
          >
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="nonbinary">Nonbinary</option>
          </select>
        </label>
        <label className="block text-sm">
          Age
          <select
            className={`${fieldClass} mt-1`}
            value={draft.ageRange}
            onChange={(e) => set({ ageRange: e.target.value })}
          >
            {AGES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm">
        Look
        <textarea
          className={`${fieldClass} mt-1 min-h-20`}
          value={draft.look}
          maxLength={1000}
          placeholder="Face, hair, skin, build, clothes. A fictional person: never a real or famous one."
          onChange={(e) => set({ look: e.target.value })}
        />
      </label>
      <label className="block text-sm">
        Voice
        <input
          className={`${fieldClass} mt-1`}
          value={draft.voiceProfile}
          maxLength={200}
          placeholder="warm and enthusiastic, mid-tempo"
          onChange={(e) => set({ voiceProfile: e.target.value })}
        />
      </label>
      {models.length > 1 ? (
        <label className="block text-sm">
          Photo model
          <select className={`${fieldClass} mt-1`} value={chosen?.key} onChange={(e) => setModelKey(e.target.value)}>
            {models.map((m) => (
              <option key={m.key} value={m.key} disabled={!m.available}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={!ready || !canDraw || create.isPending}>
          {create.isPending ? "Drawing six pictures…" : "Create the actor"}
        </Button>
        <span className="text-xs text-muted">
          {chosen
            ? `${chosen.label}, ${options.data?.pictureCount ?? 6} pictures${cost != null ? `, about $${cost.toFixed(2)}` : ""} on your key.`
            : options.data?.openrouterKey
              ? `${options.data.pictureCount} pictures on OpenRouter (${options.data.defaultModel.id}), about a cent each, on your key.`
              : null}
        </span>
      </div>
      {create.error ? <ErrorNote>{errorText(create.error)}</ErrorNote> : null}
      {create.data ? (
        <p className="text-sm" role="status">
          {create.data.name} is ready
          {create.data.costUsd != null ? ` (cost $${create.data.costUsd.toFixed(3)})` : ""}: cast them in a project or a
          shot.
        </p>
      ) : null}
    </form>
  );
}
