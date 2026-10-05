// Public barrel of the `models` module — the catalog of video models.
export { BUILTIN_MODELS, LEGACY_PROVIDER_MODEL_KEYS, builtinModels, parseModelIdOverrides } from "./builtins";
export type { BuiltinModel, CredentialId } from "./builtins";
export { resolveCatalog, effectiveDefaultModel, estimateCostUsd, canLaunch, sanitizeDefaults, LOCAL_TIMEOUT_S } from "./resolve";
export type { ResolvedModel, ModelStatus, ModelDefaults, ModelConfigRow, CredentialSource, ModelCatalog } from "./resolve";
export { sizeFor, framesFor } from "./geometry";
export type { FrameRule } from "./geometry";
export { newLocalModelKey, listModelConfigs, getModelConfig, getDefaultModelKey, setDefaultModelKey, updateModelPreferences, createLocalModel, updateLocalModel, archiveLocalModel } from "./service";
export type { ModelPreferences, LocalModelInput } from "./service";
export { modelConfigs, studioSettings } from "./schema";
