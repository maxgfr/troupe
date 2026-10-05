"use client";

import { Suspense, use, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { api } from "~/trpc/react";
import { useWorkspace } from "~/app/_components/workspace-context";
import { downloadUrl, renderFileName } from "~/app/_components/download-name";
import {
  EmptyState,
  ErrorNote,
  PageHeader,
  SignedOutNotice,
  SkeletonRows,
} from "~/app/_components/ui";
import { platformName } from "~/modules/studio/platforms";
import {
  CaptionFields,
  DisclosurePanel,
  PLATFORMS,
  PlatformPreset,
  RenderPicker,
  type Platform,
} from "./export-sections";

// Export: platform preset, caption/hashtags, and the AI disclosure —
// compliance leaves WITH the file, it is not homework. The page composes the
// named panels from export-sections.tsx. ?render=<id> preselects a render
// (the project page links here from its newest video).
export default function ExportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={null}>
      <ExportForm projectId={projectId} />
    </Suspense>
  );
}

function ExportForm({ projectId }: { projectId: string }) {
  const workspace = useWorkspace();
  const enabled = workspace.status === "ready";
  const searchParams = useSearchParams();
  const [platformChoice, setPlatform] = useState<Platform | null>(null);
  const [generationId, setGenerationId] = useState<string | null>(searchParams.get("render"));
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("#ad #AIgenerated");
  const [confirmed, setConfirmed] = useState(false);
  const [keepFormat, setKeepFormat] = useState(false);

  const project = api.studio.getProject.useQuery({ projectId }, { enabled, retry: false });
  const generations = api.generation.forProject.useQuery(
    { projectId },
    { enabled, retry: false },
  );
  const completed = (generations.data ?? []).filter((g) => g.status === "completed");
  const chosen = completed.find((g) => g.id === generationId)?.id ?? completed[0]?.id ?? null;
  const chosenRender = completed.find((g) => g.id === chosen);
  // The project's own platform, until another preset is picked.
  const projectPlatform = PLATFORMS.find((p) => p === project.data?.platform);
  const platform: Platform = platformChoice ?? projectPlatform ?? "tiktok";

  const specs = api.export.checkSpecs.useQuery(
    { projectId, generationId: chosen ?? "", platform },
    { enabled: enabled && Boolean(chosen), retry: false },
  );
  const utils = api.useUtils();
  const create = api.export.create.useMutation({
    // The exported render turns final in the timeline.
    onSuccess: () => utils.generation.forProject.invalidate({ projectId }),
  });
  const specsMismatch = Boolean(
    specs.data && typeof specs.data === "object" && "ok" in specs.data && !specs.data.ok,
  );
  // Any change after an export starts a new one: the form, not the download,
  // is the thing to act on again.
  const edit = <T,>(set: (value: T) => void) => (value: T) => {
    if (create.isSuccess) create.reset?.();
    set(value);
  };

  if (workspace.status === "unauthenticated") {
    return (
      <>
        <PageHeader title="Export" />
        <SignedOutNotice />
      </>
    );
  }

  const exported = create.isSuccess && chosenRender?.outputAssetUrl;
  return (
    <>
      <PageHeader
        title="Export"
        lede="Pick the render, check it against the platform, and download it with its caption. The AI label is set when you publish."
        actions={
          <Link href={`/projects/${projectId}`} className="inline-block py-1 text-sm text-primary underline-offset-4 hover:underline">
            ← Back to the project
          </Link>
        }
      />

      {workspace.status === "loading" || (enabled && generations.isPending) ? (
        <SkeletonRows rows={4} />
      ) : generations.error ? (
        <ErrorNote>The renders failed to load: {generations.error.message}</ErrorNote>
      ) : completed.length === 0 ? (
        <EmptyState
          title="Nothing to export yet"
          body="Render a video on the project page first, then come back to download it here."
          cta={{ label: "Open the project", href: `/projects/${projectId}` }}
        />
      ) : (
        <form
          className="max-w-2xl space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (!workspace.workspaceId || !chosen) return;
            create.mutate({
              projectId,
              generationId: chosen,
              platform,
              caption,
              hashtags: hashtags.split(/\s+/).filter(Boolean),
              qualityConfirmed: confirmed,
              acknowledgeSpecMismatch: keepFormat,
            });
          }}
        >
          <RenderPicker completed={completed} chosen={chosen} onChoose={edit((id: string) => { setGenerationId(id); setConfirmed(false); setKeepFormat(false); })} />

          <PlatformPreset platform={platform} onPick={edit((value: Platform) => { setPlatform(value); setKeepFormat(false); })} specsMismatch={specsMismatch} />

          {specsMismatch ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={keepFormat} onChange={(event) => edit(setKeepFormat)(event.target.checked)} className="mt-0.5" /><span>Keep the original video format. I will crop it separately if needed.</span></label> : null}
          {specs.error ? <ErrorNote>{specs.error.message}</ErrorNote> : null}

          <CaptionFields
            caption={caption}
            hashtags={hashtags}
            onCaption={edit(setCaption)}
            onHashtags={edit(setHashtags)}
          />

          <DisclosurePanel platform={platform} />

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => edit(setConfirmed)(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I have checked the video and am ready to download it.
            </span>
          </label>

          {create.error ? <ErrorNote>{create.error.message}</ErrorNote> : null}

          {/* One primary action at a time: create the export, then download it. */}
          {exported ? (
            <div role="status" className="space-y-3 rounded-xl border border-success/40 bg-success/10 px-4 py-3">
              <p className="text-sm">
                Export saved for {platformName(platform)}. This render is now marked final. Download it, then paste your caption when you publish.
              </p>
              <a
                href={downloadUrl(chosenRender.outputAssetUrl!, renderFileName({ project: project.data?.title, model: chosenRender.modelLabel ?? chosenRender.modelId, createdAt: chosenRender.createdAt }))}
                className="inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary transition-opacity duration-150 hover:opacity-90"
              >
                Download MP4
              </a>
            </div>
          ) : (
            <button
              type="submit"
              disabled={create.isPending || !confirmed || specs.isPending || Boolean(specs.error) || (specsMismatch && !keepFormat)}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
            >
              {create.isPending ? "Exporting…" : "Create export"}
            </button>
          )}
        </form>
      )}
    </>
  );
}
