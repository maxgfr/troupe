import { createTRPCClient, type TRPCLink } from "@trpc/client";
import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { describe, expect, it } from "vitest";

import { holdResultsUntil } from "./hold-results-link";

const t = initTRPC.create();
const router = t.router({
  held: t.procedure.query(() => "unused"),
  free: t.procedure.query(() => "unused"),
});

// Answers every call at once.
const backend: TRPCLink<typeof router> = () => ({ op }) =>
  observable((observer) => {
    queueMicrotask(() => {
      observer.next({ result: { type: "data", data: op.path } });
      observer.complete();
    });
    return () => {};
  });

function client(ready: () => Promise<void>, above: TRPCLink<typeof router>[] = []) {
  return createTRPCClient<typeof router>({ links: [...above, holdResultsUntil<typeof router>((path) => path === "held", ready), backend] });
}

describe("results held back until something is ready", () => {
  it("reach the page only once ready() has settled, for the calls it holds", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const api = client(() => gate);
    let held = "";
    const pending = api.held.query().then((answer) => (held = answer));
    expect(await api.free.query()).toBe("free");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(held).toBe("");
    release();
    await pending;
    expect(held).toBe("held");
  });

  it("end the call with the error when passing a result on throws, instead of leaving it stuck", async () => {
    const throwing: TRPCLink<typeof router> = () => ({ op, next }) =>
      observable((observer) =>
        next(op).subscribe({
          next() {
            throw new Error("a bug further up");
          },
          error: (error) => observer.error(error),
          complete: () => observer.complete(),
        }),
      );
    await expect(client(async () => {}, [throwing]).held.query()).rejects.toThrow("a bug further up");
  });
});
