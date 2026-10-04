import { parseRenderConfig } from "./config";

// The renderer's settings for this build (site/.env.example), already
// checked by the build itself.
export const RENDER_CONFIG = parseRenderConfig(import.meta.env);
