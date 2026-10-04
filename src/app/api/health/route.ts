import { sql } from "drizzle-orm";

import { db } from "~/server/db";
import { healthResponse } from "./health";

export const dynamic = "force-dynamic";

export function GET() {
  return healthResponse(() => db.execute(sql`select 1`));
}
