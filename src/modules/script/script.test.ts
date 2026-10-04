import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "~/test/db";
import { createWorkspace } from "~/modules/identity";
import { projects } from "~/modules/studio/server/schema";
import {
  SUPPORTED_EMOTIONS,
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

describe("script editing with emotion tags", () => {
  it("retagging one line stores a new version and keeps the history", async () => {
    const v1 = await pasteScript(t.db, { projectId, text: "Stop scrolling — this changed my mornings.\nTap the link before the bundle sells out." });
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

  it("an unsupported emotion is rejected", async () => {
    const v1 = await pasteScript(t.db, { projectId, text: "x" });
    await expect(setLineEmotion(t.db, { scriptId: v1.id, lineIndex: 0, emotion: "sarcastic" as never })).rejects.toThrowError(/unsupported emotion/i);
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
    expect(restored.lines.map((l) => [l.text, l.emotion])).toEqual([["Old hook.", "neutral"], ["Old call to action.", "neutral"]]);
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
