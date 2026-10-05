// Aggregated Drizzle schema: each module owns its slice under
// src/modules/<module>/server/schema.ts; this file only re-exports them so
// drizzle-kit and the runtime client see one schema.
export * from "~/modules/identity/server/schema";
export * from "~/modules/studio/server/schema";
export * from "~/modules/script/server/schema";
export * from "~/modules/actors/server/schema";
export * from "~/modules/generation/server/schema";
export * from "~/modules/generation/server/media";
export * from "~/modules/benchmark/server/schema";
export * from "~/modules/export/server/schema";
export * from "~/modules/chat/server/schema";
export * from "~/modules/library/server/schema";
export { reconcileHeartbeat } from "~/server/jobs/schema";
export { providerSettings } from "~/server/settings/schema";
export { modelConfigs, studioSettings } from "~/modules/models/schema";
