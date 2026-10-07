"use client";

import { useEffect, useRef, useState } from "react";

import { actorVoiceSamples } from "~/modules/actors/pictures";
import { StopIcon, VoiceIcon } from "./icons";

// Hear an actor before choosing them: a round button on their portrait that
// plays the short sample beside their front picture (voice.webm, voice.m4a;
// scripts/actors/voices.ts), read with the voice the renderers give them.
// Nothing downloads until it is pressed; one sample plays at a time, page
// wide; a sample that cannot load takes its button away (a cast folder
// without samples, docs/ACTORS.md), and stays away for the visit.

// The sample playing now, whichever card it belongs to.
let current: HTMLAudioElement | null = null;
const missing = new Set<string>();

// The progress ring, on the 32 px button.
const RING_R = 14.5;
const RING_LENGTH = 2 * Math.PI * RING_R;

export function VoiceSampleButton({
  name,
  portraitUrl,
  className = "",
}: {
  name: string;
  // The actor's front picture; the sample sits beside it.
  portraitUrl?: string | null;
  // Where the button sits on the card (it is absolutely placed by the caller).
  className?: string;
}) {
  const sources = actorVoiceSamples(portraitUrl);
  const key = sources?.[0]?.src ?? null;
  const audio = useRef<HTMLAudioElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const [playing, setPlaying] = useState(false);
  const [gone, setGone] = useState<string | null>(null);

  // The ring follows the sample while it plays.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const draw = () => {
      const media = audio.current;
      const done = media && media.duration > 0 ? media.currentTime / media.duration : 0;
      ring.current?.setAttribute("stroke-dashoffset", String(RING_LENGTH * (1 - Math.min(1, done))));
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // Leaving the page (or the step) stops the sample.
  useEffect(() => {
    const media = audio.current;
    return () => {
      if (!media) return;
      media.pause();
      if (current === media) current = null;
    };
  }, []);

  if (!sources || !key || gone === key || missing.has(key)) return null;

  const stopped = () => {
    const media = audio.current;
    if (media && current === media) current = null;
    setPlaying(false);
    ring.current?.setAttribute("stroke-dashoffset", String(RING_LENGTH));
  };

  const unavailable = () => {
    missing.add(key);
    stopped();
    setGone(key);
  };

  const toggle = () => {
    const media = audio.current;
    if (!media) return;
    if (playing) {
      media.pause();
      return;
    }
    if (current && current !== media) current.pause();
    current = media;
    if (media.currentTime > 0) media.currentTime = 0;
    setPlaying(true);
    media.play().catch((error: unknown) => {
      // No source this browser can play; a quick second press (AbortError)
      // or a refused start just leaves it stopped.
      if (error instanceof DOMException && error.name === "NotSupportedError") unavailable();
      else if (current === media && media.paused) stopped();
    });
  };

  const hidden = "scale-[0.25] opacity-0 blur-[4px] motion-reduce:scale-100 motion-reduce:blur-none";
  const icon =
    "absolute size-4 transition-[opacity,scale,filter] duration-150 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-opacity";

  return (
    <>
      <button
        type="button"
        aria-label={`Play ${name}'s voice`}
        aria-pressed={playing}
        onClick={toggle}
        className={`flex size-8 items-center justify-center rounded-full transition-[background-color,color,scale] duration-150 ease-out before:absolute before:-inset-1.5 before:rounded-full active:scale-[0.96] motion-reduce:active:scale-100 ${
          playing
            ? "bg-primary text-on-primary"
            : "bg-black/50 text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.16)] backdrop-blur-md hover:bg-black/70"
        } ${className}`}
      >
        <VoiceIcon className={`${icon} ${playing ? hidden : ""}`} />
        <StopIcon className={`${icon} ${playing ? "" : hidden}`} />
        <svg
          aria-hidden="true"
          viewBox="0 0 32 32"
          className={`pointer-events-none absolute inset-0 size-full -rotate-90 transition-opacity duration-250 ease-in-out motion-reduce:hidden ${
            playing ? "opacity-100" : "opacity-0"
          }`}
        >
          <circle cx="16" cy="16" r={RING_R} fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.5" />
          <circle
            ref={ring}
            cx="16"
            cy="16"
            r={RING_R}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH}
          />
        </svg>
      </button>
      <audio ref={audio} preload="none" onPlaying={() => setPlaying(true)} onPause={stopped} onEnded={stopped}>
        {sources.map((source, i) => (
          <source
            key={source.src}
            src={source.src}
            type={source.type}
            // The last source failing means none could play.
            onError={i === sources.length - 1 ? unavailable : undefined}
          />
        ))}
      </audio>
    </>
  );
}
