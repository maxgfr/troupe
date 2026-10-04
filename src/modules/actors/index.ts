// Public barrel of the `actors` module — other modules import ONLY from here.
export { seedActorLibrary, listActors, getActorSeedAssets, attachActorToProject } from "./server/service";
export { ACTOR_CATALOG, ASSET_SET, storagePathFor } from "./server/catalog";
export type { CatalogActor, CatalogAsset } from "./server/catalog";
export { actors, actorAssets } from "./server/schema";
