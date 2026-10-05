// Public barrel of the `scene` module — other modules import ONLY from here.
// Pure TypeScript (no DOM, no Node): the browser and Node renderers share it.
export { buildScene, cueAt, actorInitials, TIMING } from "./build";
export type { Scene, SceneInput, SceneLine, SceneActor, Cue, Word, Box, Layout } from "./build";
export { drawFrame, portraitShotFor, portraitShots, SCENE_FONT } from "./draw";
export type { DrawOptions, PortraitShot, SceneContext, SceneGradient, SceneImage, ScenePortraits } from "./draw";
export { voiceFor, parseVoicePools, KOKORO_VOICES } from "./voice";
export type { VoiceActor, VoiceChoice, VoicePools } from "./voice";
export { actorHue, oklch, paletteFor } from "./palette";
export type { Palette } from "./palette";
export { assembleTrack } from "./track";
export type { Speak, Speech } from "./track";
