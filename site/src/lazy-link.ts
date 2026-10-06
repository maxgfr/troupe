import { TRPCClientError, type OperationLink, type TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable, type Observable, type Unsubscribable } from "@trpc/server/observable";

// A terminating link standing for links that load with the first call: the
// browser edition's router, database and what runs around them
// (site/src/server-link.ts) arrive after the shell has painted, not before.
// The links load once; every call then runs through them in order.
export function lazyLinks<TRouter extends AnyRouter>(load: () => Promise<TRPCLink<TRouter>[]>): TRPCLink<TRouter> {
  return (runtime) => {
    let chain: Promise<OperationLink<TRouter>[]> | null = null;
    const ready = () => (chain ??= load().then((links) => links.map((link) => link(runtime))));
    return ({ op }) =>
      observable((observer) => {
        let inner: Unsubscribable | null = null;
        let closed = false;
        ready().then(
          (links) => {
            if (closed) return;
            inner = run(links, op, 0).subscribe(observer);
          },
          (cause: unknown) => {
            chain = null;
            if (!closed)
              observer.error(TRPCClientError.from(cause instanceof Error ? cause : new Error(String(cause))));
          },
        );
        return () => {
          closed = true;
          inner?.unsubscribe();
        };
      });
  };
}

type Op<TRouter extends AnyRouter> = Parameters<OperationLink<TRouter>>[0]["op"];

function run<TRouter extends AnyRouter>(
  links: OperationLink<TRouter>[],
  op: Op<TRouter>,
  index: number,
): ReturnType<OperationLink<TRouter>> {
  const link = links[index];
  if (!link) throw new Error("The last link must answer the call.");
  return link({ op, next: (nextOp) => run(links, nextOp, index + 1) as Observable<never, never> });
}
