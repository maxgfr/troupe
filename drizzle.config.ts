import type { Config } from "drizzle-kit";

import { databaseTls } from "./scripts/database-tls.mjs";
import { env } from "~/env";

export default {
  schema: "./src/server/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
    ssl: databaseTls(env.DATABASE_URL),
  },
  tablesFilter: ["troupe_*"],
} satisfies Config;
