// What a new HTTP-endpoint model is taken to render until its owner says
// otherwise: the contract's own local renderer (docs/LOCAL-MODELS.md), with a
// voice. The Settings form and `troupe models add http` both start from it.
// No imports: the CLI reads this file as is.
export const HTTP_MODEL_DEFAULTS = {
  aspectRatios: ["9:16", "16:9", "1:1"],
  resolutions: ["720p"],
  durationsS: [4, 6, 8, 10, 15],
  audio: "always",
  fps: 24,
} as const;
