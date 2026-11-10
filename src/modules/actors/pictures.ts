// Where a browser loads an actor's picture: the folder holding the cast
// (`base`, e.g. "/actors" or "https://cdn.example.com/troupe-cast") joined
// with the picture's storage path below actors/. Pure, so both editions use it.
export const DEFAULT_PICTURES_BASE = "/actors";

export function actorPictureUrl(base: string, storagePath: string): string {
  return `${base.replace(/\/+$/, "")}/${storagePath.replace(/^actors\//, "")}`;
}

// The pictures of an actor made in the studio (with a photo model) live in
// its media storage, not with the checked-in cast:
// custom-actors/<actorId>/v<version>/<shot>.<ext>, served by
// /api/actor-pictures/<actorId>/v<version>/<shot>.<ext>.
export const CUSTOM_PICTURES_PREFIX = "custom-actors/";
export const CUSTOM_PICTURES_ROUTE = "/api/actor-pictures";

export function customPicturePath(actorId: string, version: number, file: string): string {
  return `${CUSTOM_PICTURES_PREFIX}${actorId}/v${version}/${file}`;
}

export function isCustomPicture(storagePath: string): boolean {
  return storagePath.startsWith(CUSTOM_PICTURES_PREFIX);
}

// Where a browser loads any actor's picture: the cast's folder, or the
// studio's route for a made actor.
export function anyActorPictureUrl(base: string, storagePath: string): string {
  return isCustomPicture(storagePath)
    ? `${CUSTOM_PICTURES_ROUTE}/${storagePath.slice(CUSTOM_PICTURES_PREFIX.length)}`
    : actorPictureUrl(base, storagePath);
}

// An actor's voice sample sits beside their front picture (voice.webm, Opus,
// and voice.m4a, AAC, for browsers without Opus in WebM), made by
// scripts/actors/voices.ts. Listed in the order an <audio> element tries
// them; null without a front picture to find them by. A cast folder without
// samples simply fails to load them.
export interface VoiceSampleSource {
  src: string;
  type: string;
}

export function actorVoiceSamples(portraitUrl: string | null | undefined): VoiceSampleSource[] | null {
  if (!portraitUrl || !/\/front\.webp$/.test(portraitUrl)) return null;
  const beside = (file: string) => portraitUrl.replace(/front\.webp$/, file);
  return [
    { src: beside("voice.webm"), type: 'audio/webm; codecs="opus"' },
    { src: beside("voice.m4a"), type: 'audio/mp4; codecs="mp4a.40.2"' },
  ];
}
