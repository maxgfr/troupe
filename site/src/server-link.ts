import { unstable_localLink, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import SuperJSON from "superjson";

import { LOCAL_USER_ID } from "~/modules/identity";
import { appRouter, createCaller, type AppRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { forgetBrowserCatalog, loadBrowserCatalog } from "./catalog";
import { createBrowserChat } from "./chat/backend";
import { browserDatabase, rebuildGeneration, rebuildsDone } from "./db/client";
import { holdResultsUntil } from "./hold-results-link";
import { createBrowserLibrary } from "./library/backend";
import { browserMedia } from "./media";
import { rerunQueriesCaughtByRebuild } from "./rebuild-link";
import { ingestBrowserRender, keepSettledRenders } from "./render/ingest";

// The studio's server side, in the page: its router, its database (PGlite)
// and what runs around them. Loaded by the first call (site/src/trpc.tsx),
// so the shell paints before this code arrives.

// The studio's own router, called in the page instead of over HTTP: every
// procedure runs against the PGlite database in this browser.
export async function createBrowserContext() {
  const { db } = await browserDatabase();
  const chat = createBrowserChat(db);
  return createTRPCContext({ headers: new Headers(), db, media: browserMedia, userId: LOCAL_USER_ID, catalog: await loadBrowserCatalog(db), ingest: ingestBrowserRender, chat, library: createBrowserLibrary(db, chat) });
}

// A caller of the router, for code that is not a page (the library's upload).
export async function browserCaller() {
  return createCaller(await createBrowserContext());
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

// The links between the page's client and the router, last one terminating.
export function serverLinks(): TRPCLink<AppRouter>[] {
  return [
    forgetCatalogOnMutation,
    keepRendersBeforeResults,
    rerunQueriesCaughtByRebuild<AppRouter>({ generation: rebuildGeneration, rebuilt: rebuildsDone }),
    unstable_localLink({ router: appRouter, createContext: createBrowserContext, transformer: SuperJSON }),
  ];
}
