"use client";

import { useEffect, useRef, useState } from "react";

import { ActorPortrait } from "./actor-portrait";

// A project's poster: its newest video, standing still on an early frame and
// playing, muted, while the pointer rests on it or the card holds focus
// (`active`); else its actor's portrait over the actor's hue. With reduced
// motion the frame stays still. The caller sizes the frame.
export function VideoPoster({
  src,
  active,
  actor,
  className = "",
}: {
  src?: string | null;
  // The card around it is hovered or focused.
  active: boolean;
  actor?: { id: string; name: string; portraitUrl?: string | null } | null;
  className?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = video.current;
    if (!node) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (active && !still) {
      void node.play().catch(() => {});
    } else {
      node.pause();
    }
  }, [active]);

  if (src && !failed) {
    return (
      <span aria-hidden className={`relative block overflow-hidden bg-black ${className}`}>
        <video
          ref={video}
          // An early frame, not the first (often black).
          src={`${src}#t=0.6`}
          muted
          loop
          playsInline
          preload="metadata"
          disablePictureInPicture
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      </span>
    );
  }
  if (actor) {
    return <ActorPortrait id={actor.id} name={actor.name} src={actor.portraitUrl} label="" className={className} />;
  }
  return <span aria-hidden className={`block bg-surface ${className}`} />;
}
