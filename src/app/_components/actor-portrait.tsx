"use client";

import { useCallback, useState } from "react";

import { actorHue, actorInitials } from "~/modules/scene";

// An actor's portrait: their picture (public/actors/<slug>/v1/front.webp,
// served by the app or the static site) over a disc of their hue with their
// initials, the same colors as the rendered videos (src/modules/scene). The
// initials show while the picture loads and stay when it cannot load. The
// caller sizes the frame (aspect ratio and width), so nothing shifts.
export function ActorPortrait({
  id,
  name,
  label,
  src,
  className,
}: {
  id: string;
  name: string;
  // What the picture shows, for assistive technology; "" when the actor's
  // name is written right beside it.
  label: string;
  // The picture's URL (the actors list's portraitUrl); none: initials only.
  src?: string | null;
  className?: string;
}) {
  const hue = actorHue(id);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const picture = src && failed !== src ? src : null;
  // A picture already decoded (from the cache) may finish before React
  // listens for its load event.
  const ready = useCallback(
    (img: HTMLImageElement | null) => {
      if (img?.complete && img.naturalWidth > 0) setLoaded(img.getAttribute("src"));
    },
    [],
  );
  return (
    <span className={`relative block overflow-hidden ${className ?? ""}`} style={{ backgroundColor: `oklch(0.3 0.05 ${hue})` }}>
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 size-full"
        preserveAspectRatio="xMidYMid slice"
        {...(picture || !label ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
      >
        {/* Gone once the picture shows, so it is not read or copied with the name. */}
        {picture && loaded === picture ? null : (
          <text
            x="50"
            y="50"
            dominantBaseline="central"
            textAnchor="middle"
            fontSize="30"
            fontFamily="var(--font-geist-sans), system-ui, sans-serif"
            fill={`oklch(0.92 0.02 ${hue})`}
          >
            {actorInitials(name)}
          </text>
        )}
      </svg>
      {picture ? (
        // biome-ignore lint/performance/noImgElement: the static site has no next/image, and the pictures are already sized WebP files.
        <img
          key={picture}
          ref={ready}
          src={picture}
          alt={label}
          loading="lazy"
          decoding="async"
          width={768}
          height={768}
          onLoad={() => setLoaded(picture)}
          onError={() => setFailed(picture)}
          // Head-and-shoulders, framed with room above: crops to wider frames
          // keep the face by trimming more of the shoulders than the hair.
          className={`absolute inset-0 size-full object-cover object-[50%_20%] transition-opacity duration-250 ease-out ${
            loaded === picture ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}
    </span>
  );
}
