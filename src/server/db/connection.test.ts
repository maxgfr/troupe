import { describe, expect, it } from "vitest";

import { isTransactionPooler } from "../../../scripts/database-tls.mjs";
import { connectionOptions } from "./index";

describe("the runtime database connection", () => {
  it("never prepares statements and lets idle connections go", () => {
    expect(
      connectionOptions("postgresql://postgres.ref:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"),
    ).toMatchObject({ prepare: false, idle_timeout: 20, ssl: { rejectUnauthorized: true } });
    expect(connectionOptions("postgresql://postgres:pw@db:5432/troupe")).toMatchObject({
      prepare: false,
      ssl: undefined,
    });
  });

  it("recognises Supabase's transaction pooler, which it warns about at start", () => {
    expect(isTransactionPooler("postgresql://postgres.ref:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres")).toBe(
      true,
    );
    expect(isTransactionPooler("postgresql://postgres.ref:pw@aws-1-us-east-1.pooler.supabase.com:5432/postgres")).toBe(
      false,
    );
    expect(isTransactionPooler("postgresql://postgres:pw@db:6543/troupe")).toBe(false);
    expect(isTransactionPooler("not a url")).toBe(false);
  });
});
