import { pgTableCreator } from "drizzle-orm/pg-core";

// Shared table creator — every module schema uses the same `troupe_` prefix
// (multi-project schema convention from create-t3-app).
export const createTable = pgTableCreator((name) => `troupe_${name}`);
