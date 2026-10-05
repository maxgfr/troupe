import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { databaseTls } from "../../scripts/database-tls.mjs";
import { accessCodeFile, ensureAccessCode, shareAccessCode } from "./access-code";
import { prepareDatabase } from "./db/prepare";

const flag = (name: string, fallback: boolean) => {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value === "1" || value === "true";
};

async function migrateDatabase(url: string) {
  // A dedicated single connection: the advisory lock must stay on it.
  const client = postgres(url, { max: 1, prepare: false, ssl: databaseTls(url), onnotice: () => undefined });
  try {
    await prepareDatabase({
      exec: (sql) => client.unsafe(sql),
      migrate: () => migrate(drizzle(client), { migrationsFolder: join(process.cwd(), "drizzle") }),
    });
  } finally {
    await client.end({ timeout: 5 });
  }
}

// Runs once when the server process starts (src/instrumentation.ts).
export async function boot() {
  const access = ensureAccessCode();
  try {
    shareAccessCode(access);
  } catch (error) {
    console.warn(`Troupe: the access code could not be shared with the CLI container: ${(error as Error).message}`);
  }
  if (access.source === "generated" || access.source === "file") {
    console.info([
      "",
      "  Troupe is protected by an access code:",
      `      ${access.code}`,
      `  It is saved in ${accessCodeFile()}. Set TROUPE_ACCESS_CODE to choose your own.`,
      "",
    ].join("\n"));
  } else if (access.source === "none" && process.env.NODE_ENV === "production") {
    console.warn("Troupe: set TROUPE_ACCESS_CODE — without it this deployment refuses every request.");
  }

  const url = process.env.DATABASE_URL;
  // Serverless platforms start many short-lived instances behind poolers that
  // cannot hold an advisory lock: migrate those explicitly (pnpm db:migrate).
  if (url && !process.env.VERCEL && flag("TROUPE_AUTO_MIGRATE", true)) {
    await migrateDatabase(url);
    console.info(JSON.stringify({ event: "db.migrated" }));
  }

  if (flag("TROUPE_INPROCESS_WORKER", false)) {
    const { reconcileOnce, startLoop } = await import("./jobs/worker");
    startLoop("jobs.reconcile", () => reconcileOnce(), 30_000);
    console.info(JSON.stringify({ event: "jobs.worker.started", everyS: 30 }));
  }

  // The Docker stack's own renderer, added as a local model on first start
  // (TROUPE_AUTOCONFIGURE, src/server/autoconfigure.ts). In the background: it
  // waits for the renderer without holding up the studio.
  if (url && flag("TROUPE_AUTOCONFIGURE", false)) {
    const [{ startAutoconfigure }, { db }] = await Promise.all([import("./autoconfigure"), import("./db")]);
    void startAutoconfigure(db);
  }
}
