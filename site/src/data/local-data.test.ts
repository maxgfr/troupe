import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFakeLocks } from "../render/fake-locks";
import { clearMediaFiles, deleteMediaFiles, mediaFileIds, readMediaFiles, saveMediaFiles } from "../media";
import type { Backup } from "./backup";

// The database side is PGlite in a worker (tested in pglite-migrate.test.ts);
// here it is a stand-in, so the files around it can be checked in IndexedDB.
const db = vi.hoisted(() => ({
  restoreDatabase: vi.fn(async (_snapshot: unknown) => {}),
  referencedMediaIds: vi.fn(async () => new Set<string>()),
}));
vi.mock("../db/client", () => ({
  restoreDatabase: db.restoreDatabase,
  referencedMediaIds: db.referencedMediaIds,
  resetDatabase: vi.fn(),
  snapshotDatabase: vi.fn(),
}));
const jobs = vi.hoisted(() => ({ clearJobs: vi.fn(async () => {}) }));
vi.mock("../render/jobs", () => jobs);

const assign = vi.fn();
vi.stubGlobal("window", { location: { assign, reload: vi.fn() } });
// One tab here: no channel to the others.
vi.stubGlobal("BroadcastChannel", undefined);

const { pruneUnreferencedMedia, restoreBackup } = await import("./local-data");

const file = (id: string, text: string) => ({ id, storagePath: `browser/${id}.mp4`, blob: new Blob([text], { type: "video/mp4" }) });
const backup = (media: ReturnType<typeof file>[]): Backup => ({ createdAt: new Date(), database: { migrations: [], tables: {} }, media });

async function contents() {
  const files = await readMediaFiles();
  return Object.fromEntries(await Promise.all(files.map(async (f) => [f.id, await f.blob.text()] as const)));
}

beforeEach(async () => {
  installFakeLocks();
  await clearMediaFiles();
  await saveMediaFiles([file("old", "old bytes"), file("shared", "bytes here")]);
  assign.mockClear();
  jobs.clearJobs.mockReset().mockResolvedValue(undefined);
  db.restoreDatabase.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe("importing a backup", () => {
  it("leaves this browser's files as they were when the database refuses the backup", async () => {
    db.restoreDatabase.mockRejectedValue(new Error("This backup is damaged."));
    await expect(restoreBackup(backup([file("shared", "backup bytes"), file("new", "new bytes")]))).rejects.toThrow("damaged");
    expect(await contents()).toEqual({ old: "old bytes", shared: "bytes here" });
    expect(assign).not.toHaveBeenCalled();
  });

  it("ends with exactly the backup's files once the database has committed, then reloads", async () => {
    await restoreBackup(backup([file("shared", "backup bytes"), file("new", "new bytes")]));
    expect(await contents()).toEqual({ shared: "backup bytes", new: "new bytes" });
    expect(jobs.clearJobs).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith("/app/dashboard");
  });

  it("reloads onto the restored studio even when the clean-up fails", async () => {
    jobs.clearJobs.mockRejectedValue(new Error("IndexedDB went away"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await restoreBackup(backup([file("new", "new bytes")]));
    expect(assign).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
  });
});

describe("files no media asset refers to", () => {
  it("are cleared on start, and only those", async () => {
    db.referencedMediaIds.mockResolvedValue(new Set(["shared"]));
    await pruneUnreferencedMedia();
    expect(await mediaFileIds()).toEqual(["shared"]);
  });

  it("are left alone when the studio cannot say which it uses", async () => {
    db.referencedMediaIds.mockRejectedValue(new Error("The database could not start."));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await pruneUnreferencedMedia();
    expect((await mediaFileIds()).sort()).toEqual(["old", "shared"]);
    expect(warn).toHaveBeenCalled();
  });
});

describe("media files by id", () => {
  it("lists ids without reading files, and deletes by id", async () => {
    expect((await mediaFileIds()).sort()).toEqual(["old", "shared"]);
    await deleteMediaFiles(["old", "missing"]);
    expect(await mediaFileIds()).toEqual(["shared"]);
    await deleteMediaFiles([]);
    expect(await mediaFileIds()).toEqual(["shared"]);
  });
});
