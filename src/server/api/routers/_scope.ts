import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import type { Db } from "~/server/db/types";
import { scripts } from "~/modules/script";
import { generations } from "~/modules/generation";
import { benchmarkRuns } from "~/modules/benchmark";

// projectProcedure already proved workspace membership for `projectId`. These
// close the remaining gap: a resource id from a DIFFERENT project (possibly
// another workspace) must not be usable just because you own `projectId`.
export async function assertScriptInProject(db: Db, scriptId: string, projectId: string) {
  const [row] = await db.select({ projectId: scripts.projectId }).from(scripts).where(eq(scripts.id, scriptId)).limit(1);
  if (!row || row.projectId !== projectId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "script does not belong to this project" });
  }
}

export async function assertGenerationInProject(db: Db, generationId: string, projectId: string) {
  const [row] = await db.select({ projectId: generations.projectId }).from(generations).where(eq(generations.id, generationId)).limit(1);
  if (!row || row.projectId !== projectId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "generation does not belong to this project" });
  }
}

export async function assertRunInWorkspace(db: Db, runId: string, workspaceId: string) {
  const [row] = await db.select({ workspaceId: benchmarkRuns.workspaceId }).from(benchmarkRuns).where(eq(benchmarkRuns.id, runId)).limit(1);
  if (!row || row.workspaceId !== workspaceId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "benchmark run does not belong to this workspace" });
  }
}
