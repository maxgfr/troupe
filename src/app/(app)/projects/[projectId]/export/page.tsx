"use client";

import { use, useState } from "react";

import { api } from "~/trpc/react";
import { useWorkspace } from "~/app/_components/workspace-context";
import {
  EmptyState,
  ErrorNote,
  PageHeader,
  SignedOutNotice,
  SkeletonRows,
} from "~/app/_components/ui";
import {
  CaptionFields,
  DisclosurePanel,
  PlatformPreset,
  RenderPicker,
  type Platform,
} from "./export-sections";

// Export: platform preset, caption/hashtags, and the AI disclosure —
// compliance leaves WITH the file, it is not homework. The page composes the
// named panels from export-sections.tsx.
export default function ExportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const workspace = useWorkspace();
  const enabled = workspace.status === "ready";
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("#ad #AIgenerated");
  const [confirmed, setConfirmed] = useState(false);
  const [keepFormat, setKeepFormat] = useState(false);

  const generations = api.generation.forProject.useQuery(
    { projectId },
    { enabled, retry: false },
  );
  const completed = (generations.data ?? []).filter((g) => g.status === "completed");
  const chosen = generationId ?? completed[0]?.id ?? null;

  const specs = api.export.checkSpecs.useQuery(
    { projectId, generationId: chosen ?? "", platform },
    { enabled: enabled && Boolean(chosen), retry: false },
  );
  const create = api.export.create.useMutation();
  const specsMismatch = Boolean(
    specs.data && typeof specs.data === "object" && "ok" in specs.data && !specs.data.ok,
  );

  if (workspace.status === "unauthenticated") {
    return (
      <>
        <PageHeader title="Export" />
        <SignedOutNotice />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Export"
        lede="Download your video and prepare the accompanying caption. Platform labels must be set when you publish."
      />

      {workspace.status === "loading" || (enabled && generations.isPending) ? (
        <SkeletonRows rows={4} />
      ) : generations.error ? (
        <ErrorNote>The renders failed to load: {generations.error.message}</ErrorNote>
      ) : completed.length === 0 ? (
        <EmptyState
          title="Nothing to export yet"
          body="Generate a video first, then preview and download it here."
          cta={{ label: "Open the monitor", href: `/projects/${projectId}` }}
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
          <RenderPicker completed={completed} chosen={chosen} onChoose={(id) => { setGenerationId(id); setConfirmed(false); setKeepFormat(false); }} />

          <PlatformPreset platform={platform} onPick={(value) => { setPlatform(value); setKeepFormat(false); }} specsMismatch={specsMismatch} />

          {specsMismatch ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={keepFormat} onChange={(event) => setKeepFormat(event.target.checked)} className="mt-0.5" /><span>Keep the original video format. I will crop it separately if needed.</span></label> : null}
          {specs.error ? <ErrorNote>{specs.error.message}</ErrorNote> : null}

          <CaptionFields
            caption={caption}
            hashtags={hashtags}
            onCaption={setCaption}
            onHashtags={setHashtags}
          />

          <DisclosurePanel platform={platform} />

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I have checked the video and am ready to download it.
            </span>
          </label>

          {create.error ? <ErrorNote>{create.error.message}</ErrorNote> : null}
          {create.isSuccess ? (
            <p role="status" className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm">
              Export saved. Download the MP4 below and copy your caption when publishing.
            </p>
          ) : null}

          {create.data?.downloadUrl ? <a href={create.data.downloadUrl} className="inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary">Download MP4</a> : null}
          <button
            type="submit"
            disabled={create.isPending || !confirmed || specs.isPending || Boolean(specs.error) || (specsMismatch && !keepFormat)}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
          >
            {create.isPending ? "Exporting…" : "Create export"}
          </button>
        </form>
      )}
    </>
  );
}
