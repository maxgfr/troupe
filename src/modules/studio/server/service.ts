import { eq } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import { attachActorToProject } from "~/modules/actors";
import { canLaunch, type ResolvedModel } from "~/modules/models";
import { projects } from "./schema";

export type Format = "9:16" | "1:1" | "16:9";
export type Platform = "instagram" | "youtube" | "tiktok" | "linkedin";

// Platform presets constrain the format step — the preferred
// format is preselected, the others stay selectable with an explicit warning.
const PLATFORM_PREFERRED: Record<Platform, Format> = {
  tiktok: "9:16",
  instagram: "9:16",
  youtube: "16:9",
  linkedin: "1:1",
};

export interface FormatOption {
  format: Format;
  preselected: boolean;
  warning?: string;
}

export function formatOptionsFor(platform: Platform): FormatOption[] {
  const preferred = PLATFORM_PREFERRED[platform];
  return (["9:16", "1:1", "16:9"] as Format[]).map((format) => ({
    format,
    preselected: format === preferred,
    ...(format === preferred
      ? {}
      : { warning: `${platform} prefers ${preferred} — a ${format} video may need cropping or letterboxing in your video editor` }),
  }));
}

const LANGUAGE_NAMES: Record<string, string> = { en: "English", fr: "French", de: "German", es: "Spanish", it: "Italian", zh: "Chinese", ja: "Japanese", ko: "Korean", pt: "Portuguese" };
const languageName = (code: string) => LANGUAGE_NAMES[code] ?? code.toUpperCase();

export interface ModelOption {
  key: string;
  label: string;
  vendor: string;
  kind: "cloud" | "local";
  capabilities: ResolvedModel["capabilities"];
  defaults: ResolvedModel["defaults"];
  pricePerSecondUsd: number | null;
  // Ready to launch: configured, enabled, not archived.
  available: boolean;
  unavailableReason: string | null;
  // Renders the requested format.
  compatible: boolean;
  warnings: string[];
}

// The models a project can choose from, with what the user should know
// before spending on them. Disabled and archived models are not offered.
export function modelOptionsFor(models: ResolvedModel[], input: { format?: Format; language?: string }): ModelOption[] {
  return models
    .filter((m) => m.enabled && !m.archived)
    .map((m) => {
      const compatible = !input.format || m.capabilities.aspectRatios.includes(input.format);
      const warnings: string[] = [];
      if (!compatible) warnings.push(`${m.label} renders ${m.capabilities.aspectRatios.join(" and ")} only.`);
      if (m.capabilities.audio === "none") warnings.push(`${m.label} makes silent video: the actor will not speak. Add a voice track in your editor.`);
      else if (input.language && m.capabilities.dialogueLanguages && !m.capabilities.dialogueLanguages.includes(input.language)) {
        warnings.push(`${m.label} has only been tried with ${m.capabilities.dialogueLanguages.map(languageName).join(" and ")} dialogue; ${languageName(input.language)} may come out in another language.`);
      }
      return {
        key: m.key, label: m.label, vendor: m.vendor, kind: m.kind,
        capabilities: m.capabilities, defaults: m.defaults, pricePerSecondUsd: m.pricePerSecondUsd,
        available: canLaunch(m),
        unavailableReason: canLaunch(m) ? null : (m.statusDetail ?? "Not ready. Check it in Settings."),
        compatible, warnings,
      };
    });
}

export async function createDraftProject(db: Db, input: { workspaceId: string; title: string; platform?: Platform }) {
  const platform = input.platform ?? "tiktok";
  const [project] = await db
    .insert(projects)
    .values({ workspaceId: input.workspaceId, title: input.title, platform, format: PLATFORM_PREFERRED[platform], language: "en" })
    .returning();
  return project!;
}

// Every wizard choice persists immediately so an abandoned session
// restores exactly. `modelKey: null` returns the project to the studio default.
export async function updateProjectChoices(
  db: Db,
  input: { projectId: string; format?: Format; platform?: Platform; language?: string; modelKey?: string | null; title?: string },
) {
  const patch: Partial<typeof projects.$inferInsert> = {};
  if (input.format) patch.format = input.format;
  if (input.platform) patch.platform = input.platform;
  if (input.language) patch.language = input.language;
  if (input.title?.trim()) patch.title = input.title.trim();
  if (input.modelKey !== undefined) patch.modelKey = input.modelKey;
  if (Object.keys(patch).length === 0) return getProject(db, input.projectId);
  const [updated] = await db.update(projects).set(patch).where(eq(projects.id, input.projectId)).returning();
  if (!updated) throw new Error(`project ${input.projectId} not found`);
  return updated;
}

export async function getProject(db: Db, projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error(`project ${projectId} not found`);
  return project;
}

// The four choices lock in, the actor attaches (availability
// guard in the actors module), and the script step opens next.
export async function completeWizard(db: Db, input: { projectId: string; actorId: string }) {
  await getProject(db, input.projectId);
  await attachActorToProject(db, { projectId: input.projectId, actorId: input.actorId });
  const [done] = await db.update(projects).set({ status: "scripting" }).where(eq(projects.id, input.projectId)).returning();
  return done!;
}

// Recast a project: the actor must be available (actors module guard).
// The wizard's other choices go through updateProjectChoices.
export async function changeProjectActor(db: Db, input: { projectId: string; actorId: string }) {
  await getProject(db, input.projectId);
  await attachActorToProject(db, input);
  return getProject(db, input.projectId);
}

// One commit for the wizard: invalid choices never leave an orphan project.
export async function createProjectFromWizard(db: Db, input: {
  workspaceId: string; title: string; platform: Platform; format: Format;
  language: string; actorId: string; modelKey?: string | null;
}) {
  return db.transaction(async (tx) => {
    const connection = tx as unknown as Db;
    const project = await createDraftProject(connection, input);
    await updateProjectChoices(connection, { ...input, projectId: project.id });
    return completeWizard(connection, { projectId: project.id, actorId: input.actorId });
  });
}
