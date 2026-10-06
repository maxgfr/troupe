"use client";

import { ActorPortrait } from "./actor-portrait";
import { VideoStill } from "./video-still";

// A project's poster: its newest video as a still (playing, muted, while the
// card is hovered or focused: `active`), else its actor's portrait over the
// actor's hue, which also stands in when the video is not fetched (saving
// data) or cannot load. The caller sizes the frame.
export function VideoPoster({
  src,
  active,
  actor,
  className = "",
  sizes,
  priority = false,
}: {
  src?: string | null;
  active: boolean;
  actor?: { id: string; name: string; portraitUrl?: string | null } | null;
  className?: string;
  // For the actor's picture: how wide it shows, and whether it is above the fold.
  sizes?: string;
  priority?: boolean;
}) {
  const portrait = actor ? (
    <ActorPortrait id={actor.id} name={actor.name} src={actor.portraitUrl} label="" sizes={sizes} priority={priority} className={className} />
  ) : (
    <span aria-hidden className={`block bg-surface ${className}`} />
  );
  if (!src) return portrait;
  return <VideoStill src={src} active={active} fallback={portrait} className={className} />;
}
