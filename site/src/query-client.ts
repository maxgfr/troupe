import { createQueryClient } from "~/trpc/query-client";

// The pages' query client in the browser edition: the studio's, except that
// nothing waits for the network. Every query and change runs on this
// browser's own database, so going offline (a train, a flaky Wi-Fi) must not
// pause them, as React Query does by default for calls it assumes need it.
export function createBrowserQueryClient() {
  const client = createQueryClient();
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    queries: { ...client.getDefaultOptions().queries, networkMode: "always" },
    mutations: { ...client.getDefaultOptions().mutations, networkMode: "always" },
  });
  return client;
}
