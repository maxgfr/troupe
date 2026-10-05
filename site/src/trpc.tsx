import { QueryClientProvider } from "@tanstack/react-query";
import { loggerLink, unstable_localLink, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { useState } from "react";
import SuperJSON from "superjson";

import { LOCAL_USER_ID } from "~/modules/identity";
import { appRouter, type AppRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { createQueryClient } from "~/trpc/query-client";
import { api } from "~/trpc/react";
import { forgetBrowserCatalog, loadBrowserCatalog } from "./catalog";
import { holdResultsUntil } from "./hold-results-link";
import { createBrowserChat } from "./chat/backend";
import { browserDatabase, rebuildGeneration, rebuildsDone } from "./db/client";
import { browserMedia } from "./media";
import { rerunQueriesCaughtByRebuild } from "./rebuild-link";
import { ingestBrowserRender, keepSettledRenders } from "./render/ingest";

// The studio's own router, called in the page instead of over HTTP: every
// procedure runs against the PGlite database in this browser.
async function createContext() {
  const { db } = await browserDatabase();
  return createTRPCContext({ headers: new Headers(), db, media: browserMedia, userId: LOCAL_USER_ID, catalog: await loadBrowserCatalog(db), ingest: ingestBrowserRender, chat: createBrowserChat(db) });
}

// The catalog is read once and kept (site/src/catalog.ts); a mutation may
// change it (Settings), so it is read again before anyone sees the result.
const forgetCatalogOnMutation: TRPCLink<AppRouter> = () => ({ op, next }) =>
  observable((observer) =>
    next(op).subscribe({
      next(result) {
        if (op.type === "mutation") forgetBrowserCatalog();
        observer.next(result);
      },
      error(error) {
        if (op.type === "mutation") forgetBrowserCatalog();
        observer.error(error);
      },
      complete: () => observer.complete(),
    }),
  );

// The procedures that poll renders, and may record one, in their transaction.
const RECONCILING = new Set(["generation.forProject", "benchmark.get"]);

// Keeps the files of renders recorded by now-committed transactions, and
// forgets their jobs (site/src/render/ingest.ts). Never throws.
export async function keepRecordedRenders(): Promise<void> {
  try {
    await keepSettledRenders((await browserDatabase()).db);
  } catch (error) {
    console.warn("Finished renders could not be stored:", error);
  }
}

// The result of a reconciling call reaches the page only once the files of
// the renders it recorded are stored: the timeline never offers a video the
// media service worker cannot serve yet. Every tab does the same for itself.
const keepRendersBeforeResults = holdResultsUntil<AppRouter>((path) => RECONCILING.has(path), keepRecordedRenders);

export function BrowserTRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const [client] = useState(() =>
    api.createClient({
      links: [
        loggerLink({ enabled: (op) => import.meta.env.DEV || (op.direction === "down" && op.result instanceof Error) }),
        forgetCatalogOnMutation,
        keepRendersBeforeResults,
        rerunQueriesCaughtByRebuild<AppRouter>({ generation: rebuildGeneration, rebuilt: rebuildsDone }),
        unstable_localLink({ router: appRouter, createContext, transformer: SuperJSON }),
      ],
    }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={client} queryClient={queryClient}>
        {children}
      </api.Provider>
    </QueryClientProvider>
  );
}
