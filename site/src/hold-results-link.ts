import { TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";

// Holds back each result of the calls `holds` picks until `ready()` has
// settled for it, then passes it on; errors and the end of the call follow in
// the order they came. Should passing something on throw (a bug further up),
// the call ends with that error instead of leaving the rest stuck behind it.
export function holdResultsUntil<TRouter extends AnyRouter>(holds: (path: string) => boolean, ready: () => Promise<void>): TRPCLink<TRouter> {
  return () =>
    ({ op, next }) =>
      observable((observer) => {
        if (!holds(op.path)) return next(op).subscribe(observer);
        let delivered: Promise<unknown> = Promise.resolve();
        const after = (deliver: () => unknown) => {
          delivered = delivered.then(deliver).catch((error: unknown) => observer.error(TRPCClientError.from(error instanceof Error ? error : new Error(String(error)))));
        };
        return next(op).subscribe({
          next(result) {
            after(() => ready().then(() => observer.next(result)));
          },
          error: (error) => after(() => observer.error(error)),
          complete: () => after(() => observer.complete()),
        });
      });
}
