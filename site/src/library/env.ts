import { parseLibraryConfig, type BrowserLibraryConfig } from "./config";

// The library's settings for this build (site/.env.example), checked by the
// build and handed over as one constant (site/vite.config.ts). Tests run
// without the build: defaults then.
declare const __LIBRARY_CONFIG__: BrowserLibraryConfig | undefined;

export const LIBRARY_CONFIG: BrowserLibraryConfig = typeof __LIBRARY_CONFIG__ === "undefined" ? parseLibraryConfig({}) : __LIBRARY_CONFIG__;
