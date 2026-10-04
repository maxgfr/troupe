import { beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "~/test/db";
import { createWorkspace } from "~/modules/identity";
import { seedActorLibrary, listActors } from "~/modules/actors";
import { completeWizard, createDraftProject, formatOptionsFor, getProject, updateProjectChoices } from "~/modules/studio";

const USER = "b1111111-1111-4111-8111-111111111111";

let t: TestDb;
let ws: string;
let actorId: string;

beforeAll(async () => {
  t = await createTestDb();
  ws = (await createWorkspace(t.db, { userId: USER, name: "Studio" })).id;
  await seedActorLibrary(t.db);
  actorId = (await listActors(t.db, {}))[0]!.id;
});

describe("guided creation wizard", () => {
  it("picking 9:16, TikTok, French and an actor creates the project with exactly those four and opens scripting in French", async () => {
    const draft = await createDraftProject(t.db, { workspaceId: ws, title: "Wizard run" });
    await updateProjectChoices(t.db, { projectId: draft.id, platform: "tiktok", format: "9:16", language: "fr" });
    const done = await completeWizard(t.db, { projectId: draft.id, actorId });
    expect(done.format).toBe("9:16");
    expect(done.platform).toBe("tiktok");
    expect(done.language).toBe("fr");
    expect(done.actorId).toBe(actorId);
    expect(done.status).toBe("scripting");
  });

  it("the project's model choice persists, and clearing it returns to the studio default", async () => {
    const draft = await createDraftProject(t.db, { workspaceId: ws, title: "Model choice" });
    await updateProjectChoices(t.db, { projectId: draft.id, modelKey: "kling-3.0" });
    expect((await getProject(t.db, draft.id)).modelKey).toBe("kling-3.0");
    await updateProjectChoices(t.db, { projectId: draft.id, modelKey: null });
    expect((await getProject(t.db, draft.id)).modelKey).toBeNull();
  });

  it("TikTok preselects 9:16 and keeps 1:1/16:9 selectable with an explicit crop/letterbox warning", () => {
    const options = formatOptionsFor("tiktok");
    const nineSixteen = options.find((o) => o.format === "9:16")!;
    const square = options.find((o) => o.format === "1:1")!;
    const wide = options.find((o) => o.format === "16:9")!;
    expect(nineSixteen.preselected).toBe(true);
    expect(nineSixteen.warning).toBeUndefined();
    expect(square.warning).toMatch(/crop|letterbox/i);
    expect(wide.warning).toMatch(/crop|letterbox/i);
  });

  it("an abandoned wizard session restores format, platform and language exactly", async () => {
    const draft = await createDraftProject(t.db, { workspaceId: ws, title: "Abandoned" });
    await updateProjectChoices(t.db, { projectId: draft.id, platform: "linkedin", format: "16:9", language: "de" });
    // ... user closes the tab before the actor step ...
    const reopened = await getProject(t.db, draft.id);
    expect(reopened.platform).toBe("linkedin");
    expect(reopened.format).toBe("16:9");
    expect(reopened.language).toBe("de");
    expect(reopened.status).toBe("draft");
  });
});

