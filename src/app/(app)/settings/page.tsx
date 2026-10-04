"use client";

import { api } from "~/trpc/react";
import { useWorkspace } from "~/app/_components/workspace-context";
import { ProviderAccounts } from "./provider-accounts";
import { DefaultModelSettings, ModelCatalogSettings } from "./model-catalog";
import { AddLocalModel } from "./add-local-model";
import { ChatSettings } from "./chat-settings";
import { ThemeToggle } from "~/app/_components/theme-toggle";
import { DemoUnavailable, ResetDemoData, useEdition } from "~/app/_components/edition";
import {
  ErrorNote,
  PageHeader,
  ProviderWarning,
  Section,
  Skeleton,
} from "~/app/_components/ui";
import { describeHeartbeat } from "./heartbeat-age";

// Personal studio settings.
export default function SettingsPage() {
  const workspace = useWorkspace();
  const edition = useEdition();
  const demo = edition.kind === "demo";
  // The demo has no background worker: renders would run in the page.
  const heartbeat = api.ops.reconcileHeartbeat.useQuery(undefined, { refetchInterval: 60_000, enabled: !demo });
  const beat = describeHeartbeat(heartbeat.data ?? null, new Date());

  return (
    <>
      <PageHeader
        title="Settings"
        lede="Your personal studio: appearance, video models, the script chat and provider accounts."
      />

      <Section title="Appearance">
        <ThemeToggle />
        <p className="mt-2 max-w-[72ch] text-xs text-muted">
          Dark is the control-room default — you judge renders in it. The choice persists on this
          device and follows your system preference until you pick one.
        </p>
      </Section>

      <Section title="Your studio">
        {workspace.status === "error" ? <ErrorNote>{workspace.message}</ErrorNote> : demo ? (
          <div className="space-y-3">
            <p className="max-w-[72ch] text-sm text-muted">
              Your projects stay in this browser, on this device. No account is needed, and clearing the site&apos;s data
              in your browser deletes them too.
            </p>
            <ResetDemoData resetData={edition.resetData} />
          </div>
        ) : (
          <p className="text-sm text-muted">Your projects stay in this installation. No account is needed.</p>
        )}
      </Section>

      <Section title="Default model">
        <DefaultModelSettings />
      </Section>

      <Section title="Cloud models">
        <ModelCatalogSettings kind="cloud" />
      </Section>

      <div id="script-chat" className="scroll-mt-24">
        <Section title="Script chat">
          <ChatSettings />
        </Section>
      </div>

      <Section title="Provider accounts">
        {demo ? (
          <DemoUnavailable>
            Cloud providers need the self-hosted studio, which keeps your API keys encrypted on your own server and calls
            the provider from there. The browser demo never asks for a key.
          </DemoUnavailable>
        ) : (
          <ProviderAccounts />
        )}
      </Section>

      <Section title="Local models">
        <div className="space-y-4">
          <ModelCatalogSettings kind="local" />
          {demo ? (
            <DemoUnavailable>
              ComfyUI and other model servers on your machine or network are reached by the self-hosted studio. A page
              served from the web cannot connect to them.
            </DemoUnavailable>
          ) : (
            <AddLocalModel />
          )}
        </div>
      </Section>

      {demo ? null : <Section title="Background checks">
        <p className="max-w-[72ch] text-sm text-muted">
          The studio checks running renders every 30 seconds and saves finished videos, even after you
          close the browser. A render that outlives its model&apos;s time limit (cloud models: 30 minutes;
          local models: 2 hours by default) is marked failed.
        </p>
        {heartbeat.isPending ? (
          <Skeleton className="mt-3 h-10 w-full max-w-md" />
        ) : heartbeat.error ? (
          <ErrorNote>The worker status could not be loaded: {heartbeat.error.message}</ErrorNote>
        ) : beat === null ? (
          <p className="mt-3 max-w-[72ch] text-sm text-muted">
            No check has run yet. The Docker image runs them by itself; with <code className="font-mono text-xs">pnpm start</code>{" "}
            set <code className="font-mono text-xs">TROUPE_INPROCESS_WORKER=1</code>, and on Vercel schedule{" "}
            <code className="font-mono text-xs">/api/jobs/reconcile</code> (docs/VERCEL-SUPABASE.md).
          </p>
        ) : (
          <div className="mt-3 max-w-md">
            <div className="rounded-xl border border-muted/25 px-4 py-3 text-sm">
              <p>
                Last run <span className="font-medium">{beat.ageLabel}</span>
                <span className="text-muted"> · processed {heartbeat.data!.processed}</span>
              </p>
            </div>
            {beat.stale ? (
              <div className="mt-2">
                <ProviderWarning>
                  Over 5 minutes since the last check. Make sure the app process is running (Docker:{" "}
                  <code className="font-mono text-xs">docker compose ps</code>), or on Vercel that the schedule calling{" "}
                  <code className="font-mono text-xs">/api/jobs/reconcile</code> still runs.
                </ProviderWarning>
              </div>
            ) : null}
          </div>
        )}
      </Section>}
    </>
  );
}
