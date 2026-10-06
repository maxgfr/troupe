import { createTRPCClient, TRPCClientError, type TRPCLink } from "@trpc/client";
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
  const backend: TRPCLink<typeof router> =
    () =>
    ({ op }) =>
      observable((observer) => {
        calls.push(op.path);
        const answer = answers.shift() ?? "after";
        // "during" and "failed during" start a rebuild; "failed…" fails.
        if (answer.endsWith("during")) {
          generation += 1;
          rebuilt = new Promise((resolve) => {
            finish = resolve;
          });
        }
        queueMicrotask(() => {
          if (answer.startsWith("failed"))
            return observer.error(TRPCClientError.from(new Error("relation does not exist")));
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

  it("are asked again when they failed because of the rebuild", async () => {
    const h = harness();
    h.answers.push("failed during");
    const answer = h.client.workspaces.query();
    await new Promise((resolve) => setTimeout(resolve, 10));
    h.finish();
    expect(await answer).toBe("after");
    expect(h.calls).toEqual(["workspaces", "workspaces"]);
  });

  it("wait out a second rebuild that catches them again", async () => {
    const h = harness();
    h.answers.push("during", "during");
    const answer = h.client.workspaces.query();
    await new Promise((resolve) => setTimeout(resolve, 10));
    h.finish();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.calls).toEqual(["workspaces", "workspaces"]);
    h.finish();
    expect(await answer).toBe("after");
    expect(h.calls).toEqual(["workspaces", "workspaces", "workspaces"]);
  });

  it("are not asked again when the page gave up on them while they waited", async () => {
    const h = harness();
    h.answers.push("during");
    const abort = new AbortController();
    const answer = h.client.workspaces.query(undefined, { signal: abort.signal });
    await new Promise((resolve) => setTimeout(resolve, 10));
    abort.abort();
    h.finish();
    await expect(answer).rejects.toThrow(/aborted/);
    expect(h.calls).toEqual(["workspaces"]);
  });

  it("pass a failure on when no rebuild happened", async () => {
    const h = harness();
    h.answers.push("failed");
    await expect(h.client.workspaces.query()).rejects.toThrow();
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
