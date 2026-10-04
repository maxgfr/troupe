import { QueryClientProvider } from "@tanstack/react-query";
import { loggerLink, unstable_localLink } from "@trpc/client";
import { useState } from "react";
import SuperJSON from "superjson";

import { LOCAL_USER_ID } from "~/modules/identity";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { createQueryClient } from "~/trpc/query-client";
import { api } from "~/trpc/react";
import { loadDemoCatalog } from "./catalog";
import { demoDatabase } from "./db/client";
import { demoMedia } from "./media";

// The studio's own router, called in the page instead of over HTTP: every
// procedure runs against the PGlite database in this browser.
async function createContext() {
  const { db } = await demoDatabase();
  return createTRPCContext({ headers: new Headers(), db, media: demoMedia, userId: LOCAL_USER_ID, catalog: await loadDemoCatalog(db) });
}

export function DemoTRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const [client] = useState(() =>
    api.createClient({
      links: [
        loggerLink({ enabled: (op) => import.meta.env.DEV || (op.direction === "down" && op.result instanceof Error) }),
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
