"use client";

import { createContext, useContext, useEffect, useState } from "react";

// The stage light: a soft wash of colour at the top of every page, behind the
// bar and the page header. Cobalt by default (the control room's instrument
// light); a project page lights it in its actor's hue (src/modules/scene
// actorHue), the way the actor's portrait and video carry it. The hue
// glides from one page to the next (--stage-hue is a registered number in
// globals.css).

const DEFAULT_HUE = 250;

const StageContext = createContext<(hue: number | null) => void>(() => {});

export function useStageHue(hue: number | null | undefined) {
  const set = useContext(StageContext);
  useEffect(() => {
    if (hue == null) return;
    set(hue);
    return () => set(null);
  }, [hue, set]);
}

export function StageProvider({ children }: { children: React.ReactNode }) {
  const [hue, setHue] = useState<number | null>(null);
  return (
    <StageContext.Provider value={setHue}>
      <div aria-hidden className="stage-wash" style={{ "--stage-hue": hue ?? DEFAULT_HUE } as React.CSSProperties} />
      {children}
    </StageContext.Provider>
  );
}
