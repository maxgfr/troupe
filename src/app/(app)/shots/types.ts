import type { RouterOutputs } from "~/trpc/react";

export type ShotModel = RouterOutputs["shots"]["models"]["models"][number];
export type Shot = RouterOutputs["shots"]["list"][number];

// A photo or voice model, as the composer shows it.
export type MediaShotModel = RouterOutputs["shots"]["mediaModels"][number] & {
  priceLabel: string | null;
  unavailableReason: string | null;
};

// What Reuse puts back in the composer.
export interface ShotDraft {
  text: string;
  modelKey: string;
  aspectRatio: string;
  durationS: number;
  resolution: string;
}
