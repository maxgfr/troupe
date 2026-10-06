import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildScene } from "../../src/modules/scene";
import { encodeFrames, framesInput } from "./render";

// An "ffmpeg" that records its pid and reads frames until stdin closes, like
// the real one waiting for the next frame. The pid file appears whole, by a
// rename: `echo $$ > pid` creates it empty first, and a kill in between left
// "" to read, pid 0, and kill(0, 0) succeeds on our own process group.
const FAKE_FFMPEG = `#!/bin/sh
dir="$(dirname "$0")"
echo $$ > "$dir/pid.tmp"
mv "$dir/pid.tmp" "$dir/pid"
exec cat > /dev/null
`;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("encodeFrames", () => {
  let dir = "";
  const ffmpeg = process.env.FFMPEG;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "troupe-renderer-encode-"));
    await writeFile(join(dir, "ffmpeg"), FAKE_FFMPEG);
    await chmod(join(dir, "ffmpeg"), 0o755);
    process.env.FFMPEG = join(dir, "ffmpeg");
  });
  afterEach(async () => {
    if (ffmpeg === undefined) delete process.env.FFMPEG;
    else process.env.FFMPEG = ffmpeg;
    await rm(dir, { recursive: true, force: true });
  });

  it("stops ffmpeg when a frame fails to draw", async () => {
    const scene = buildScene({ width: 64, height: 64, fps: 4, actor: { id: "a", name: "A" }, lines: [{ role: "hook", text: "One two three.", emotion: "neutral" }] });
    const pidFile = join(dir, "pid");
    let drawn = 0;
    const draw = () => {
      if (++drawn < 3) return;
      // Fail once the "ffmpeg" is up and has said who it is.
      const until = Date.now() + 5000;
      while (!existsSync(pidFile) && Date.now() < until);
      throw new Error("The canvas broke.");
    };
    await expect(encodeFrames(framesInput(scene), scene, draw)).rejects.toThrow("The canvas broke.");
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(pid).toBeGreaterThan(0);
    await expect.poll(() => alive(pid), { timeout: 2000 }).toBe(false);
  });
});
