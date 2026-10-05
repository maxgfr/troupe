import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { afterAll, describe, expect, it } from "vitest";

import { DEFAULT_PORTRAITS_DIR, loadPortraits } from "./portraits";

const dir = mkdtempSync(join(tmpdir(), "troupe-portraits-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function picture(file: string, side: number) {
  const canvas = createCanvas(side, side);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#c08040";
  ctx.fillRect(0, 0, side, side);
  mkdirSync(join(dir, "lea-01", "v1"), { recursive: true });
  writeFileSync(join(dir, "lea-01", "v1", file), canvas.toBuffer("image/webp"));
}

picture("front.webp", 48);
picture("happy.webp", 32);
writeFileSync(join(dir, "lea-01", "v1", "calm.webp"), "not a picture");

describe("loadPortraits", () => {
  it("decodes the shots the scene needs from the portraits folder", async () => {
    const log: string[] = [];
    const portraits = await loadPortraits(
      dir,
      { front: "actors/lea-01/v1/front.webp", happy: "actors/lea-01/v1/happy.webp", excited: "actors/lea-01/v1/excited.webp" },
      ["front", "happy"],
      (m) => log.push(m),
    );
    expect(Object.keys(portraits).sort()).toEqual(["front", "happy"]);
    expect([portraits.front!.width, portraits.happy!.width]).toEqual([48, 32]);
    expect(log).toEqual([]);
  });

  it("leaves out pictures that are missing or unreadable, and says so", async () => {
    const log: string[] = [];
    const portraits = await loadPortraits(
      dir,
      { front: "actors/lea-01/v1/front.webp", calm: "actors/lea-01/v1/calm.webp", excited: "actors/lea-01/v1/excited.webp" },
      ["front", "calm", "excited"],
      (m) => log.push(m),
    );
    expect(Object.keys(portraits)).toEqual(["front"]);
    expect(log).toHaveLength(2);
    expect(log.join("\n")).toMatch(/calm\.webp/);
    expect(log.join("\n")).toMatch(/excited\.webp/);
  });

  it("has nothing to load for an actor without pictures", async () => {
    expect(await loadPortraits(dir, undefined, ["front"])).toEqual({});
  });

  it("reads the checked-in cast by default", () => {
    expect(DEFAULT_PORTRAITS_DIR).toMatch(/public[\\/]actors$/);
  });
});
