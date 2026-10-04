import type { Migration } from "~/server/db/pglite-migrate";

// Every drizzle/*.sql migration, bundled as text, in name order.
const files = import.meta.glob<string>("../../../drizzle/*.sql", { query: "?raw", import: "default", eager: true });

export const MIGRATIONS: Migration[] = Object.entries(files)
  .map(([path, sql]) => ({ name: path.slice(path.lastIndexOf("/") + 1), sql }))
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
