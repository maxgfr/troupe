import { createTRPCClient, TRPCClientError, type TRPCLink } from "@trpc/client";
import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { describe, expect, it } from "vitest";

import { lazyLinks } from "./lazy-link";

const t = initTRPC.create();
const router = t.router({
  one: t.procedure.query(() => "unused"),
  two: t.procedure.query(() => "unused"),
});
type R = typeof router;

// Answers each call with its path, after a link above has tagged it.
const backend: TRPCLink<R> = () => ({ op }) =>
  observable((observer) => {
    queueMicrotask(() => {
      observer.next({ result: { type: "data", data: `${op.path}${(op.context.tag as string | undefined) ?? ""}` } });
      observer.complete();
    });
    return () => {};
  });
const tagging: TRPCLink<R> = () => ({ op, next }) => next({ ...op, context: { ...op.context, tag: "!" } });

describe("links loaded with the first call", () => {
  it("loads them once, on the first call, and runs every call through them in order", async () => {
    let loads = 0;
    const api = createTRPCClient<R>({
      links: [
        lazyLinks<R>(async () => {
          loads += 1;
          return [tagging, backend];
        }),
      ],
    });
    expect(loads).toBe(0);
    expect(await Promise.all([api.one.query(), api.two.query()])).toEqual(["one!", "two!"]);
    expect(await api.one.query()).toBe("one!");
    expect(loads).toBe(1);
  });

  it("fails the call, as a client error, when the links cannot be loaded", async () => {
    const api = createTRPCClient<R>({ links: [lazyLinks<R>(() => Promise.reject(new Error("offline")))] });
    const error = await api.one.query().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TRPCClientError);
    expect((error as Error).message).toBe("offline");
  });
});
