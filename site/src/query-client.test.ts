import { onlineManager } from "@tanstack/react-query";
import { afterEach, expect, it } from "vitest";

import { createBrowserQueryClient } from "./query-client";

// The browser edition's queries and changes run on this browser's own
// database: going offline must not pause them, as React Query does by
// default for calls it assumes need the network.
afterEach(() => onlineManager.setOnline(true));

it("runs queries and changes while the browser is offline", async () => {
  onlineManager.setOnline(false);
  const client = createBrowserQueryClient();
  const read = client.fetchQuery({ queryKey: ["projects"], queryFn: async () => ["Cold brew"] });
  const saved = client.getMutationCache().build(client, { mutationFn: async (title: string) => title }).execute("Spring drop");
  const settled = await Promise.race([Promise.all([read, saved]), new Promise((resolve) => setTimeout(() => resolve("paused"), 500))]);
  expect(settled).toEqual([["Cold brew"], "Spring drop"]);
});
