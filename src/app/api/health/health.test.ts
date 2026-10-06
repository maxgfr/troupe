import { describe, expect, it } from "vitest";

import { healthResponse } from "./health";

describe("health check", () => {
  it("answers ok once the database answers, and nothing else", async () => {
    const ok = await healthResponse(async () => undefined);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 503 without leaking the database error", async () => {
    const down = await healthResponse(async () => {
      throw new Error("password authentication failed for user postgres");
    });
    expect(down.status).toBe(503);
    expect(await down.text()).toBe(JSON.stringify({ ok: false }));
  });
});
