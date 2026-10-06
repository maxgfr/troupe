import { desc, eq } from "drizzle-orm";

import type { Db } from "~/server/db/types";
import type { MediaLinks } from "~/server/media/store";
import { generations, mediaAssets } from "~/modules/generation";
import { exportRecords } from "./schema";
import { platformName } from "~/modules/studio";

export type ExportPlatform = "instagram" | "youtube" | "tiktok" | "linkedin";

// Per-platform documented specs the export sheet surfaces.
const PLATFORM_SPECS: Record<ExportPlatform, { formats: string[]; maxDurationS: number }> = {
  tiktok: { formats: ["9:16"], maxDurationS: 600 },
  instagram: { formats: ["9:16", "1:1"], maxDurationS: 90 },
  youtube: { formats: ["16:9", "9:16"], maxDurationS: 43200 },
  linkedin: { formats: ["1:1", "16:9"], maxDurationS: 600 },
};

async function loadCompletedGeneration(db: Db, generationId: string) {
  const [gen] = await db.select().from(generations).where(eq(generations.id, generationId)).limit(1);
  if (!gen) throw new Error("This render no longer exists.");
  if (gen.status !== "completed")
    throw new Error("Only finished renders can be exported. Wait for this one to complete.");
  if (!gen.outputAssetId) throw new Error("This render is still being saved. Try again in a minute.");
  return gen;
}

export async function checkExportSpecs(db: Db, input: { generationId: string; platform: ExportPlatform }) {
  const gen = await loadCompletedGeneration(db, input.generationId);
  const spec = PLATFORM_SPECS[input.platform];
  const mismatches: string[] = [];
  if (!spec.formats.includes(gen.aspectRatio)) {
    mismatches.push(
      `the video is ${gen.aspectRatio} but ${platformName(input.platform)} documents ${spec.formats.join(" or ")}`,
    );
  }
  if (gen.durationS > spec.maxDurationS) {
    mismatches.push(`the video is ${gen.durationS}s but ${platformName(input.platform)} caps at ${spec.maxDurationS}s`);
  }
  return { ok: mismatches.length === 0, mismatches, spec };
}

export interface CreateExportInput {
  generationId: string;
  platform: ExportPlatform;
  caption: string;
  hashtags: string[];
  // An explicit human quality confirmation must exist before the download unlocks.
  qualityConfirmedBy?: string;
  acknowledgeSpecMismatch?: boolean;
}

export async function createExport(db: Db, input: CreateExportInput, media: MediaLinks) {
  const gen = await loadCompletedGeneration(db, input.generationId);
  if (!input.qualityConfirmedBy) {
    throw new Error("Confirm that you watched the video and that it is ready to publish.");
  }
  const check = await checkExportSpecs(db, { generationId: input.generationId, platform: input.platform });
  if (!check.ok && !input.acknowledgeSpecMismatch) {
    throw new Error(
      `This video does not match ${platformName(input.platform)}'s specs: ${check.mismatches.join("; ")}. Confirm to export anyway.`,
    );
  }
  const [render] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, gen.outputAssetId!)).limit(1);
  // The export and the render turning final commit together: a render is a
  // draft until it is exported.
  const record = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(exportRecords)
      .values({
        projectId: gen.projectId,
        generationId: gen.id,
        platform: input.platform,
        filePath: render!.storagePath,
        caption: input.caption,
        hashtags: input.hashtags,
        aiDisclosure: true,
        qualityConfirmedBy: input.qualityConfirmedBy,
      })
      .returning();
    await tx.update(generations).set({ tier: "final" }).where(eq(generations.id, gen.id));
    return row;
  });
  return { ...record!, downloadUrl: media.urlFor(gen.outputAssetId!, { download: true }) };
}

// A project's exports, newest first, each with the link that downloads its
// video (null once the render's file is gone).
export async function listExports(db: Db, projectId: string, media: MediaLinks) {
  const rows = await db
    .select({ record: exportRecords, outputAssetId: generations.outputAssetId })
    .from(exportRecords)
    .leftJoin(generations, eq(generations.id, exportRecords.generationId))
    .where(eq(exportRecords.projectId, projectId))
    .orderBy(desc(exportRecords.createdAt));
  return rows.map(({ record, outputAssetId }) => ({
    ...record,
    downloadUrl: outputAssetId ? media.urlFor(outputAssetId, { download: true }) : null,
  }));
}
