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
import { forgetDemoCatalog, loadDemoCatalog } from "./catalog";
import { demoDatabase } from "./db/client";
import { demoMedia } from "./media";
import { ingestBrowserRender } from "./render/ingest";

// The studio's own router, called in the page instead of over HTTP: every
// procedure runs against the PGlite database in this browser.
async function createContext() {
  const { db } = await demoDatabase();
  return createTRPCContext({ headers: new Headers(), db, media: demoMedia, userId: LOCAL_USER_ID, catalog: await loadDemoCatalog(db), ingest: ingestBrowserRender });
}

// The catalog is read once and kept (site/src/catalog.ts); a mutation may
// change it (Settings), so it is read again before anyone sees the result.
const forgetCatalogOnMutation: TRPCLink<AppRouter> = () => ({ op, next }) =>
  observable((observer) =>
    next(op).subscribe({
      next(result) {
        if (op.type === "mutation") forgetDemoCatalog();
        observer.next(result);
      },
      error(error) {
        if (op.type === "mutation") forgetDemoCatalog();
        observer.error(error);
      },
      complete: () => observer.complete(),
    }),
  );

export function DemoTRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const [client] = useState(() =>
    api.createClient({
      links: [
        loggerLink({ enabled: (op) => import.meta.env.DEV || (op.direction === "down" && op.result instanceof Error) }),
        forgetCatalogOnMutation,
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
