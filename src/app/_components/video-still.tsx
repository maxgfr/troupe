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
  const [wide, setWide] = useState(false);
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
        onLoadedMetadata={(event) => setWide(event.currentTarget.videoWidth >= event.currentTarget.videoHeight)}
        // A square or landscape video shows whole, on black: cropped to a
        // portrait frame it would lose its actor card and its captions. A
        // vertical one fills the frame, cut a little above and more below:
        // in a 3:4 frame it shows from a tenth of its height down to 85%,
        // its actor card (from 11%) to its captions (centred on 60%, at
        // most to 78%), clear of the status drawn on the poster's corner.
        className={`size-full ${wide ? "object-contain" : "object-cover object-[50%_40%]"}`}
      />
    </span>
  );
}
