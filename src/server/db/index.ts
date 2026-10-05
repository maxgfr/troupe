import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseTls } from "../../../scripts/database-tls.mjs";

import { env } from "~/env";
import * as schema from "./schema";

/**
 * Cache the database connection in development. This avoids creating a new connection on every HMR
 * update.
 */
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

// No prepared statements, so a transaction-mode pooler cannot lose them; idle
// connections close after 20 s, so serverless instances give their pooler
// slots back. Queries are pipelined: on Supabase use the session pooler
// (port 5432), not the transaction pooler (port 6543), which stalled for good
// on pipelined queries in local testing (Supavisor 2.9.13; Supabase's hosted
// pooler not verified; docs/VERCEL-SUPABASE.md).
export function connectionOptions(url: string) {
  return { prepare: false, max: 3, idle_timeout: 20, ssl: databaseTls(url) } as const;
}

const conn = globalForDb.conn ?? postgres(env.DATABASE_URL, connectionOptions(env.DATABASE_URL));
if (env.NODE_ENV !== "production") globalForDb.conn = conn;

export const db = drizzle(conn, { schema });
