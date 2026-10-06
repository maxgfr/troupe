import { beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "~/server/db/schema";
import type { Db } from "~/server/db/types";
import { createTestDb, type TestDb } from "~/test/db";
import { createWorkspace } from "~/modules/identity";
import { projects } from "~/modules/studio/server/schema";
import {
  MAX_SCRIPT_LINES,
  SUPPORTED_EMOTIONS,
  ScriptTooManyLinesError,
  ScriptTooLongError,
  assertScriptFitsClip,
  estimateDurationS,
  getScriptHistory,
  pasteScript,
  restoreScriptVersion,
  setLineEmotion,
} from "~/modules/script";

const USER = "51111111-1111-4111-8111-111111111111";

let t: TestDb;
let projectId: string;

beforeAll(async () => {
  t = await createTestDb();
  const ws = await createWorkspace(t.db, { userId: USER, name: "Scripts" });
  const [p] = await t.db
    .insert(projects)
    .values({ workspaceId: ws.id, title: "Coffee ad", format: "9:16", platform: "tiktok", language: "fr" })
    .returning();
  projectId = p!.id;
});

describe("pasting a script", () => {
  it("refuses more lines than the studio keeps per version, as it refuses as many emotions", async () => {
    const text = Array.from({ length: MAX_SCRIPT_LINES + 1 }, (_, i) => `Line ${i}.`).join("\n");
    await expect(pasteScript(t.db, { projectId, text })).rejects.toBeInstanceOf(ScriptTooManyLinesError);
    const most = Array.from({ length: MAX_SCRIPT_LINES }, (_, i) => `Line ${i}.`).join("\n\n");
    expect((await pasteScript(t.db, { projectId, text: most })).lines).toHaveLength(MAX_SCRIPT_LINES);
  });

  it("reads the emotions to keep from the newest version under the lock that allocates the next one", async () => {
    const queries: string[] = [];
    const logged = drizzle(t.pg, {
      schema,
      logger: { logQuery: (query) => void queries.push(query) },
    }) as unknown as Db;
    await pasteScript(logged, { projectId, text: "Locked read." });
    const lock = queries.findIndex((q) =>
      /from "troupe_project" where "troupe_project"\."id" = \$1 for update$/.test(q),
    );
    const newest = queries.findIndex((q) =>
      /from "troupe_script" where "troupe_script"\."projectId" = \$1 order by "troupe_script"\."version" desc limit \$2$/.test(
        q,
      ),
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(newest).toBeGreaterThan(lock);
  });
});

describe("script editing with emotion tags", () => {
  it("retagging one line stores a new version and keeps the history", async () => {
    const v1 = await pasteScript(t.db, {
      projectId,
      text: "Stop scrolling — this changed my mornings.\nTap the link before the bundle sells out.",
    });
    const v2 = await setLineEmotion(t.db, { scriptId: v1.id, lineIndex: 0, emotion: "excited" });
    expect(v2.version).toBe(v1.version + 1);
    expect(v2.lines[0]!.emotion).toBe("excited");
    expect(v2.lines[1]!.emotion).toBe(v1.lines[1]!.emotion);
    const history = await getScriptHistory(t.db, projectId);
    const versions = history.map((s) => s.version);
    expect(versions).toContain(v1.version);
    expect(versions).toContain(v2.version);
    expect(history.find((s) => s.id === v1.id)!.lines[0]!.emotion).toBe("neutral");
  });

  it("amending retags the version in place instead of adding one", async () => {
    const v1 = await pasteScript(t.db, { projectId, text: "Amend me.\nAnd me." });
    const same = await setLineEmotion(t.db, { scriptId: v1.id, lineIndex: 1, emotion: "calm", amend: true });
    expect(same).toMatchObject({ id: v1.id, version: v1.version });
    expect(same.lines.map((l) => l.emotion)).toEqual(["neutral", "calm"]);
    const history = await getScriptHistory(t.db, projectId);
    expect(history.at(-1)!.id).toBe(v1.id);
    expect(history.at(-1)!.lines.map((l) => l.emotion)).toEqual(["neutral", "calm"]);
  });

  it("an unsupported emotion is rejected", async () => {
    const v1 = await pasteScript(t.db, { projectId, text: "x" });
    await expect(
      setLineEmotion(t.db, { scriptId: v1.id, lineIndex: 0, emotion: "sarcastic" as never }),
    ).rejects.toThrowError(/unsupported emotion/i);
    expect(SUPPORTED_EMOTIONS).toContain("neutral");
  });

  it("an edited script keeps the emotion of every line whose text did not change", async () => {
    const v1 = await pasteScript(t.db, { projectId, text: "Keep me.\nChange me.\nKeep me too." });
    await setLineEmotion(t.db, { scriptId: v1.id, lineIndex: 0, emotion: "happy" });
    const v2 = (await getScriptHistory(t.db, projectId)).at(-1)!;
    await setLineEmotion(t.db, { scriptId: v2.id, lineIndex: 2, emotion: "serious" });
    const v4 = await pasteScript(t.db, { projectId, text: "Keep me.\nChanged.\nKeep me too." });
    expect(v4.lines.map((l) => l.emotion)).toEqual(["happy", "neutral", "serious"]);
  });

  it("restores an older version as a new version", async () => {
    const old = await pasteScript(t.db, { projectId, text: "Old hook.\nOld call to action." });
    await setLineEmotion(t.db, { scriptId: old.id, lineIndex: 1, emotion: "excited" });
    await pasteScript(t.db, { projectId, text: "Something else entirely." });
    const restored = await restoreScriptVersion(t.db, old.id);
    expect(restored.version).toBeGreaterThan(old.version);
    expect(restored.lines.map((l) => [l.text, l.emotion])).toEqual([
      ["Old hook.", "neutral"],
      ["Old call to action.", "neutral"],
    ]);
    expect((await getScriptHistory(t.db, projectId)).at(-1)!.id).toBe(restored.id);
  });

  it("a pasted script splits into lines with a neutral default emotion", async () => {
    const script = await pasteScript(t.db, { projectId, text: "First hook line\nSome middle content\nBuy it now" });
    expect(script.origin).toBe("pasted");
    expect(script.lines).toHaveLength(3);
    expect(script.lines.map((l) => l.role)).toEqual(["hook", "body", "cta"]);
    for (const line of script.lines) expect(line.emotion).toBe("neutral");
  });

  it("a script longer than the clip is refused showing estimated vs allowed seconds", async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    expect(estimateDurationS(fifty)).toBe(20); // 50 words ÷ 2.5 w/s
    const script = await pasteScript(t.db, { projectId, text: fifty });
    expect(script.estimatedDurationS).toBe(20);
    try {
      assertScriptFitsClip(script, { clipLengthS: 8 });
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as ScriptTooLongError;
      expect(err).toBeInstanceOf(ScriptTooLongError);
      expect(err.estimatedS).toBe(20);
      expect(err.allowedS).toBe(8);
      expect(err.message).toMatch(/20.*8|8.*20/);
    }
  });
});
