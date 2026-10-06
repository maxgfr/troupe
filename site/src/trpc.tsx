import { QueryClientProvider } from "@tanstack/react-query";
import { loggerLink } from "@trpc/client";
import { useState } from "react";

import type { AppRouter } from "~/server/api/root";
import { createQueryClient } from "~/trpc/query-client";
import { api } from "~/trpc/react";
import { afterFirstPaint } from "./first-paint";
import { lazyLinks } from "./lazy-link";

// The pages' tRPC client. Its calls run in the page against the studio's own
// router and this browser's database (site/src/server-link.ts), loaded with
// the first call so the shell paints first.
export function BrowserTRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const [client] = useState(() =>
    api.createClient({
      links: [
        loggerLink({ enabled: (op) => import.meta.env.DEV || (op.direction === "down" && op.result instanceof Error) }),
        lazyLinks<AppRouter>(() => afterFirstPaint().then(() => import("./server-link")).then((m) => m.serverLinks())),
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
