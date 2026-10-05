// Public barrel of the `script` module — other modules import ONLY from here.
export {
  SUPPORTED_EMOTIONS,
  ScriptTooLongError,
  estimateDurationS,
  assertScriptFitsClip,
  pasteScript,
  saveScriptLines,
  restoreScriptVersion,
  setLineEmotion,
  getScriptHistory,
  getScript,
  lockScript,
} from "./server/service";
export type { Emotion, DraftLine, LineRole, ScriptWithLines } from "./server/service";
export { scripts, scriptLines } from "./server/schema";
