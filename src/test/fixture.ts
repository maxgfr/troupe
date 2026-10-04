import type { Db } from "~/server/db/types";
import { createWorkspace } from "~/modules/identity";
import { listActors, seedActorLibrary } from "~/modules/actors";
import { completeWizard, createDraftProject, updateProjectChoices } from "~/modules/studio";
import { pasteScript } from "~/modules/script";

export interface Fixture {
  workspaceId: string;
  projectId: string;
  actorId: string;
  scriptId: string;
}

// A workspace, the seeded actor library, one wizard-completed
// project and a pasted script — enough for a router happy path.
export async function seedFixture(db: Db, opts: { userId: string; name: string }): Promise<Fixture> {
  const workspaceId = (await createWorkspace(db, { userId: opts.userId, name: opts.name })).id;
  await seedActorLibrary(db);
  const actorId = (await listActors(db, {}))[0]!.id;
  const project = await createDraftProject(db, { workspaceId, title: `${opts.name} project` });
  await updateProjectChoices(db, { projectId: project.id, platform: "tiktok", format: "9:16", language: "en" });
  await completeWizard(db, { projectId: project.id, actorId });
  const script = await pasteScript(db, { projectId: project.id, text: "Hook line. Body line. Call to action now." });
  return { workspaceId, projectId: project.id, actorId, scriptId: script.id };
}
