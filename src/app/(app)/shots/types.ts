import type { RouterOutputs } from "~/trpc/react";

export type ShotModel = RouterOutputs["shots"]["models"]["models"][number];
export type Shot = RouterOutputs["shots"]["list"][number];

// What Reuse puts back in the composer.
export interface ShotDraft {
  text: string;
  modelKey: string;
  aspectRatio: string;
  durationS: number;
  resolution: string;
}
