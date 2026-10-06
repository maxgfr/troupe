import { afterEach, describe, expect, it, vi } from "vitest";

// boot() with migrations, the worker and first-start wiring turned off: only
// the checks it makes on its settings run.
vi.mock("./access-code", () => ({
  ensureAccessCode: () => ({ code: "boot-test-code", source: "environment" }),
  shareAccessCode: () => undefined,
  accessCodeFile: () => "/dev/null",
}));

import { boot } from "./boot";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function quietStart(url: string) {
  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("TROUPE_AUTO_MIGRATE", "0");
  vi.stubEnv("TROUPE_INPROCESS_WORKER", "0");
  vi.stubEnv("TROUPE_AUTOCONFIGURE", "0");
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

describe("boot", () => {
  it("warns when DATABASE_URL is Supabase's transaction pooler", async () => {
    const warn = quietStart("postgresql://postgres.ref:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres");
    await boot();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^Troupe: DATABASE_URL is Supabase's transaction pooler \(port 6543\)/),
    );
    expect(warn.mock.calls[0]![0]).toMatch(/session pooler \(port 5432\)/);
  });

  it("says nothing for the session pooler or another server", async () => {
    const warn = quietStart("postgresql://postgres.ref:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres");
    await boot();
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:pw@db:5432/troupe");
    await boot();
    expect(warn).not.toHaveBeenCalled();
  });
});
