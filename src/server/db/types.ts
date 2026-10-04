import type { PgDatabase } from "drizzle-orm/pg-core";

// Driver-agnostic database handle: production runs postgres-js, tests run
// pglite. Module services accept this so both work unchanged.
// biome-ignore lint/suspicious/noExplicitAny: any driver and schema
export type Db = PgDatabase<any, any, any>;
