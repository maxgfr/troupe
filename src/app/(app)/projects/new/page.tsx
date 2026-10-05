"use client";

import { WizardStepper } from "./wizard-stepper";
import { ActorStep, FormatStep, LanguageStep, PlatformStep, type ActorView, type FormatOptionView } from "./wizard-steps";
import { initialWizardState, wizardReducer, STEPS } from "./wizard-state";
import { pickModel, type ModelOptionView } from "../model-choice";
import { useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { useWorkspace } from "~/app/_components/workspace-context";
import { ErrorNote, PageHeader, SignedOutNotice } from "~/app/_components/ui";

// The page is the coordinator — state in the wizard reducer, one
// component per step, the launch sequence at the bottom.
export default function NewProjectPage() {
  const router = useRouter();
  const workspace = useWorkspace();
  const [wizard, dispatch] = useReducer(wizardReducer, initialWizardState);
  // The title is asked first: Continue says so instead of letting the
  // missing title surface only at the last step.
  const [titleMissing, setTitleMissing] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const formatOptions = api.studio.formatOptions.useQuery({ platform: wizard.platform }, { retry: false });
  const chosenFormat = wizard.format ?? formatOptions.data?.find((option) => option.preselected)?.format ?? null;
  const models = api.studio.modelOptions.useQuery(
    { format: chosenFormat ?? "9:16", language: wizard.language },
    { enabled: chosenFormat !== null, retry: false },
  );
  const actors = api.actors.list.useQuery(undefined, { retry: false });

  const options = (models.data?.models ?? []) as ModelOptionView[];
  const selectedModel = pickModel(options, wizard.modelKey, models.data?.defaultModelKey);

  const createProject = api.studio.createFromWizard.useMutation();



  if (workspace.status === "unauthenticated") {
    return (
      <>
        <PageHeader title="New project" />
        <SignedOutNotice />
      </>
    );
  }

  const busy = createProject.isPending;

  async function launch() {
    if (!workspace.workspaceId || !chosenFormat || !wizard.actorId || !wizard.title.trim()) return;
    dispatch({ type: "submitError", message: null });
    try {
      const project = await createProject.mutateAsync({
        workspaceId: workspace.workspaceId,
        title: wizard.title.trim(),
        platform: wizard.platform,
        format: chosenFormat,
        language: wizard.language,
        actorId: wizard.actorId,
        // Only an explicit pick is pinned; otherwise the project follows the studio default.
        modelKey: wizard.modelKey ?? undefined,
      });
      router.push(`/projects/${project!.id}/script`);
    } catch (error) {
      dispatch({
        type: "submitError",
        message: error instanceof Error ? error.message : "The project could not be created.",
      });
    }
  }

  return (
    <>
      <PageHeader
        title="New project"
        lede="Choose a platform, format, language and actor, then write your script."
      />
      <WizardStepper current={wizard.step} />

      <div className="max-w-2xl space-y-8">
        <div className="space-y-1.5">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Project title</span>
            <input
              ref={titleRef}
              maxLength={200}
              value={wizard.title}
              aria-invalid={titleMissing || undefined}
              aria-describedby={titleMissing ? "title-missing" : undefined}
              onChange={(e) => {
                dispatch({ type: "title", title: e.target.value });
                if (e.target.value.trim()) setTitleMissing(false);
              }}
              placeholder="Spring drop — short video"
              className={`w-full rounded-lg border bg-bg px-3 py-2 outline-none transition-colors duration-150 focus:border-primary ${titleMissing ? "border-warning" : "border-muted/40"}`}
            />
          </label>
          {titleMissing ? (
            <p id="title-missing" className="text-xs text-warning">
              Name the project first. It tells your projects and downloads apart.
            </p>
          ) : null}
        </div>

        {wizard.step === 0 ? (
          <PlatformStep
            platform={wizard.platform}
            onPlatform={(platform) => dispatch({ type: "platform", platform })}
          />
        ) : null}

        {wizard.step === 1 ? (
          <FormatStep
            pending={formatOptions.isPending}
            options={(formatOptions.data ?? []) as FormatOptionView[]}
            chosenFormat={chosenFormat}
            platform={wizard.platform}
            models={options}
            defaultModelKey={models.data?.defaultModelKey ?? null}
            selectedModel={selectedModel?.key ?? null}
            onFormat={(format) => dispatch({ type: "format", format })}
            onModel={(modelKey) => dispatch({ type: "model", modelKey })}
          />
        ) : null}

        {wizard.step === 2 ? (
          <LanguageStep
            language={wizard.language}
            onLanguage={(language) => dispatch({ type: "language", language })}
            warnings={selectedModel?.warnings ?? []}
          />
        ) : null}

        {wizard.step === 3 ? (
          <ActorStep
            pending={actors.isPending}
            errorMessage={actors.error?.message ?? null}
            actors={(actors.data ?? []) as ActorView[]}
            actorId={wizard.actorId}
            onActor={(actorId) => dispatch({ type: "actor", actorId })}
          />
        ) : null}

        {formatOptions.error || models.error ? <ErrorNote>{(formatOptions.error ?? models.error)!.message}</ErrorNote> : null}
        {wizard.submitError ? <ErrorNote>{wizard.submitError}</ErrorNote> : null}

        <div className="flex items-center justify-between border-t border-muted/15 pt-5">
          <button
            type="button"
            onClick={() => dispatch({ type: "back" })}
            disabled={wizard.step === 0 || busy}
            className="rounded-lg px-4 py-2 text-sm text-muted transition-colors duration-150 hover:text-fg disabled:opacity-40"
          >
            Back
          </button>
          {wizard.step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => {
                if (wizard.step === 0 && !wizard.title.trim()) {
                  setTitleMissing(true);
                  titleRef.current?.focus();
                  return;
                }
                dispatch({ type: "next" });
              }}
              disabled={wizard.step === 1 && !chosenFormat}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={launch}
              disabled={busy || !wizard.actorId || !wizard.title.trim() || workspace.status !== "ready"}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create project → script"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
