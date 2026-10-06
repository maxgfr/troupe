"use client";

import { useEffect, useRef, useState } from "react";

// A render's video as a still (a poster, a timeline row, an export pick):
// an early frame, the first being often black. It fetches nothing until it
// comes near the screen (so thirty projects are not thirty range requests at
// once, on connections the pages' own calls share), and nothing at all when
// the visitor asks to save data: the fallback shows instead, as it does when
// the video cannot load. While `active` (a hovered or focused card) it plays,
// muted; then it goes back to its frame. With reduced motion it stays still.
// The caller sizes the frame.

const FRAME_S = 0.6;

function savesData(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData)
  );
}

export function VideoStill({
  src,
  fallback,
  active = false,
  className = "",
}: {
  src: string;
  // What shows when no video does: the actor's portrait, a film glyph.
  fallback: React.ReactNode;
  active?: boolean;
  className?: string;
}) {
  const frame = useRef<HTMLSpanElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  const [failed, setFailed] = useState(false);
  const [skip] = useState(savesData);

  useEffect(() => {
    const node = frame.current;
    if (!node || near || skip) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near, skip]);

  useEffect(() => {
    const node = video.current;
    if (!node) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (active && !still) {
      void node.play()?.catch(() => {});
    } else {
      node.pause();
      node.currentTime = FRAME_S;
    }
  }, [active]);

  if (skip || failed) return <>{fallback}</>;
  return (
    <span ref={frame} aria-hidden className={`relative block overflow-hidden bg-black ${className}`}>
      <video
        ref={video}
        src={near ? `${src}#t=${FRAME_S}` : undefined}
        muted
        loop
        playsInline
        preload="metadata"
        disablePictureInPicture
        onError={() => setFailed(true)}
        // A vertical video keeps its top (the actor's name) and its middle
        // (the captions) in a shorter frame.
        className="size-full object-cover object-top"
      />
    </span>
  );
}
