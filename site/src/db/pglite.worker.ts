import { PGlite } from "@electric-sql/pglite";
import { worker } from "@electric-sql/pglite/worker";

import { INIT_FAILED } from "./protocol";

// One tab is elected leader and runs Postgres here; every tab, the leader
// included, talks to it through PGliteWorker (site/src/db/client.ts).

const fail = (reason: unknown) =>
  self.postMessage({ type: INIT_FAILED, message: reason instanceof Error ? reason.message : String(reason) });

void worker({
  async init({ dataDir }) {
    try {
      return await PGlite.create({ dataDir });
    } catch (error) {
      fail(error);
      throw error;
    }
  },
});
