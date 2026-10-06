"use client";

import { useCallback, useState } from "react";

import { actorHue, actorInitials } from "~/modules/scene";

// An actor's portrait: their picture (public/actors/<slug>/v1/front.webp,
// served by the app or the browser edition) over a disc of their hue with their
// initials, the same colors as the rendered videos (src/modules/scene). The
// initials show while the picture loads and stay when it cannot load. The
// caller sizes the frame (aspect ratio and width), so nothing shifts, and
// says how wide it shows (`sizes`): the browser then picks the 160 or 320 px
// copy (front-160.webp, front-320.webp, scripts/actors/thumbnails.sh) over
// the 768 px picture. A cast folder without the copies falls back to it.

const THUMB_WIDTHS = [160, 320] as const;

function srcSetFor(src: string): string | undefined {
  if (!/\/front\.webp$/.test(src)) return undefined;
  return [...THUMB_WIDTHS.map((w) => `${src.replace(/front\.webp$/, `front-${w}.webp`)} ${w}w`), `${src} 768w`].join(", ");
}
export function ActorPortrait({
  id,
  name,
  label,
  src,
  className,
  sizes = "160px",
  priority = false,
}: {
  id: string;
  name: string;
  // What the picture shows, for assistive technology; "" when the actor's
  // name is written right beside it.
  label: string;
  // The picture's URL (the actors list's portraitUrl); none: initials only.
  src?: string | null;
  className?: string;
  // How wide the frame shows, as an <img sizes> value.
  sizes?: string;
  // Above the fold (the first posters): loaded at once, early.
  priority?: boolean;
}) {
  const hue = actorHue(id);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // The smaller copies, until one fails to load.
  const [thumbs, setThumbs] = useState(true);
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
        // biome-ignore lint/performance/noImgElement: the browser edition has no next/image, and the pictures are already sized WebP files.
        <img
          key={`${picture}${thumbs ? "" : "#full"}`}
          ref={ready}
          src={picture}
          srcSet={thumbs ? srcSetFor(picture) : undefined}
          sizes={thumbs ? sizes : undefined}
          alt={label}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
          width={768}
          height={768}
          onLoad={() => setLoaded(picture)}
          onError={() => (thumbs && srcSetFor(picture) ? setThumbs(false) : setFailed(picture))}
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
