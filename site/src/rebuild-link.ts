import { TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable, type Unsubscribable } from "@trpc/server/observable";

// Deleting all local data or importing a backup rebuilds the studio's tables,
// then seeds the studio again (site/src/db/client.ts). A call that started
// before the rebuild waits for it in PGlite's queue and may read the tables
// in between: an empty studio, which the app shell would take for a broken
// one. Such a query's answer is dropped and the query asked again once the
// rebuild is over, unless the page aborted it meanwhile. A mutation is never
// repeated.
export function rerunQueriesCaughtByRebuild<TRouter extends AnyRouter>(rebuilds: {
  // Goes up when a rebuild starts in this tab.
  generation: () => number;
  // Settles when no rebuild runs any more.
  rebuilt: () => Promise<void>;
}): TRPCLink<TRouter> {
  return () =>
    ({ op, next }) =>
      observable((observer) => {
        if (op.type !== "query") return next(op).subscribe(observer);
        let current: Unsubscribable | undefined;
        let stopped = false;
        const run = () => {
          if (stopped) return;
          // The page gave up on it while it waited (a query's AbortSignal).
          if (op.signal?.aborted) return observer.error(TRPCClientError.from(new Error("The query was aborted.")));
          const started = rebuilds.generation();
          let caught = false;
          const again = () => {
            caught = true;
            current?.unsubscribe();
            void rebuilds.rebuilt().then(run, run);
          };
          current = next(op).subscribe({
            next(result) {
              if (rebuilds.generation() !== started) again();
              else observer.next(result);
            },
            error(error) {
              if (rebuilds.generation() !== started) again();
              else observer.error(error);
            },
            complete() {
              if (!caught) observer.complete();
            },
          });
        };
        run();
        return () => {
          stopped = true;
          current?.unsubscribe();
        };
      });
}
