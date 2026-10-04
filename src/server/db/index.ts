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

// Supabase's transaction-mode pooler (port 6543) does not support prepared
// statements — keep them off for serverless runtime connections.
const conn = globalForDb.conn ?? postgres(env.DATABASE_URL, { prepare: false, max: 3, ssl: databaseTls(env.DATABASE_URL) });
if (env.NODE_ENV !== "production") globalForDb.conn = conn;

export const db = drizzle(conn, { schema });
