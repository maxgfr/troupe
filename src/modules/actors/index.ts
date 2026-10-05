// Public barrel of the `actors` module — other modules import ONLY from here.
export { seedActorLibrary, listActors, getActorSeedAssets, attachActorToProject, ActorUnavailableError } from "./server/service";
export { ACTOR_CATALOG, ASSET_SET, storagePathFor } from "./server/catalog";
export { actorPictureUrl, DEFAULT_PICTURES_BASE } from "./pictures";
export type { CatalogActor, CatalogAsset } from "./server/catalog";
export { actors, actorAssets } from "./server/schema";
