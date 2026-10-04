// Public barrel of the `generation` module — other modules import ONLY from here.
export { launchGeneration, ingestRender, listGenerationsForProject } from "./server/service";
export type { LaunchInput } from "./server/service";
export { compilePrompt, validateRequest, AdapterError } from "./server/adapter";
export type { HttpLike, VideoProviderAdapter, ModelCapabilities, ModelFamily, AudioSupport, ConnectionReport, CreateJobRequest, JobActor, JobOutcome, JobScript, PromptLine, ProviderJobStatus } from "./server/adapter";
export { watchGeneration, reconcileDueJobs, createPgOrchestrator, FIRST_POLL_DELAY_S, pollBackoffS } from "./server/orchestrator";
export { clampPollEveryS } from "./server/adapter";
export type { JobOrchestrator, ReconcileResult, RenderIngestor, WatchInput } from "./server/orchestrator";
export { generations, generationWatches } from "./server/schema";
export { mediaAssets } from "./server/media";
export type { MediaProbe } from "./server/media";
export { createVeoTextAdapter, type VeoModel } from "./server/adapters/veo-text";
export { createFalAdapter, type FalModel } from "./server/adapters/fal";
export { createBrowserAdapter, BROWSER_CAPABILITIES, BROWSER_MODEL_KEY, BROWSER_MODEL_LABEL } from "./server/adapters/browser";
export type { BrowserJobState, BrowserRenderJob, BrowserRenderer } from "./server/adapters/browser";
export { prepareGeneration, submitGeneration } from "./server/launch";
