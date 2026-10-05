// Where a browser loads an actor's picture: the folder holding the cast
// (`base`, e.g. "/actors" or "https://cdn.example.com/troupe-cast") joined
// with the picture's storage path below actors/. Pure, so both editions use it.
export const DEFAULT_PICTURES_BASE = "/actors";

export function actorPictureUrl(base: string, storagePath: string): string {
  return `${base.replace(/\/+$/, "")}/${storagePath.replace(/^actors\//, "")}`;
}
