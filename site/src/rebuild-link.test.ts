import { createTRPCClient, type TRPCLink } from "@trpc/client";
import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { describe, expect, it } from "vitest";

import { rerunQueriesCaughtByRebuild } from "./rebuild-link";

// A query that started before the studio's tables were rebuilt (Delete all
// local data, an import) may read them in between, before the studio is
// seeded again: its answer is thrown away and the query asked again once the
// rebuild is over. Mutations are never repeated.

const t = initTRPC.create();
const router = t.router({
  workspaces: t.procedure.query(() => "unused"),
  rename: t.procedure.mutation(() => "unused"),
});

function harness() {
  let generation = 0;
  let finish: () => void = () => {};
  let rebuilt = Promise.resolve();
  const answers: string[] = [];
  const calls: string[] = [];
  // Stands in for the local link: the first answer comes back while a rebuild
  // runs, the next ones after it.
  const backend: TRPCLink<typeof router> = () => ({ op }) =>
    observable((observer) => {
      calls.push(op.path);
      const answer = answers.shift() ?? "after";
      if (answer === "during") {
        generation += 1;
        rebuilt = new Promise((resolve) => {
          finish = resolve;
        });
      }
      queueMicrotask(() => {
        observer.next({ result: { type: "data", data: answer } });
        observer.complete();
      });
      return () => {};
    });
  const link = rerunQueriesCaughtByRebuild<typeof router>({ generation: () => generation, rebuilt: () => rebuilt });
  const client = createTRPCClient<typeof router>({ links: [link, backend] });
  return { client, answers, calls, finish: () => finish() };
}

describe("queries caught by a rebuild of the studio", () => {
  it("are asked again once the rebuild is over, and only that answer is seen", async () => {
    const h = harness();
    h.answers.push("during");
    const answer = h.client.workspaces.query();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.calls).toEqual(["workspaces"]);
    h.finish();
    expect(await answer).toBe("after");
    expect(h.calls).toEqual(["workspaces", "workspaces"]);
  });

  it("go through untouched when no rebuild happened", async () => {
    const h = harness();
    expect(await h.client.workspaces.query()).toBe("after");
    expect(h.calls).toEqual(["workspaces"]);
  });

  it("never repeat a mutation", async () => {
    const h = harness();
    h.answers.push("during");
    expect(await h.client.rename.mutate()).toBe("during");
    expect(h.calls).toEqual(["rename"]);
  });
});
