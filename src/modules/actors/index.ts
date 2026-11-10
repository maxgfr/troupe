// Public barrel of the `actors` module — other modules import ONLY from here.
export {
  seedActorLibrary,
  listActors,
  getActorSeedAssets,
  attachActorToProject,
  ActorUnavailableError,
} from "./server/service";
export { ACTOR_CATALOG, ASSET_SET, libraryVoice, storagePathFor, VOICE_SAMPLE_FILES } from "./server/catalog";
export {
  actorPictureUrl,
  actorVoiceSamples,
  anyActorPictureUrl,
  customPicturePath,
  CUSTOM_PICTURES_PREFIX,
  CUSTOM_PICTURES_ROUTE,
  DEFAULT_PICTURES_BASE,
  isCustomPicture,
} from "./pictures";
export type { VoiceSampleSource } from "./pictures";
export type { CatalogActor, CatalogAsset } from "./server/catalog";
export type { ListedActor } from "./server/service";
export { actors, actorAssets } from "./server/schema";
