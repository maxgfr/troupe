import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

import { THEME_SCRIPT } from "../src/app/theme-script";
import { parseRenderConfig } from "./src/render/config";
import { headScript, pagesFallback, serverGuard, shimModules } from "./vite-plugins";

// The static demo: the studio's own pages and tRPC router, running in the
// browser on PGlite. Served from https://<user>.github.io/troupe/: the landing
// page at /troupe/, the app at /troupe/app/*.
const REPO = resolve(import.meta.dirname, "..");
const SITE = import.meta.dirname;
const BASE = "/troupe/";
const OUT = resolve(SITE, "dist");

// The browser bundle may not pull in Node built-ins, server code or Next
// internals (site/vite-plugins.ts).
const guard = () =>
  serverGuard({
    nodeBuiltinsAllowedIn: {
      // PGlite ships one build for Node and browsers: these imports sit on
      // its Node-only paths (file:// data directories, Emscripten's Node
      // loader, dump compression) and never run with idb:// in a browser.
      "@electric-sql/pglite": { builtins: ["fs", "fs/promises", "path", "module", "stream", "stream/promises", "util", "zlib"], reason: "Node-only code paths" },
      // Under Node, kokoro-js reads its voices from disk. Its package.json
      // maps both modules to nothing for browsers, where it fetches the
      // voices instead (checking that readFile exists first).
      "kokoro-js": { builtins: ["path", "fs/promises"], reason: "Node-only voice files" },
    },
  });

export default defineConfig(({ mode }) => {
  // The renderer's VITE_* settings (site/.env.example): a bad value stops
  // the build here rather than a render in a visitor's browser.
  parseRenderConfig(loadEnv(mode, SITE, "VITE_"));
  return {
    root: SITE,
    base: BASE,
    appType: "mpa",
    publicDir: resolve(SITE, "public"),
    resolve: {
      alias: [
        { find: /^~\//, replacement: `${resolve(REPO, "src")}/` },
        { find: /^next\/link$/, replacement: resolve(SITE, "src/shims/next-link.tsx") },
        { find: /^next\/navigation$/, replacement: resolve(SITE, "src/shims/next-navigation.ts") },
      ],
    },
    plugins: [
      // Saving secrets needs a key kept on a server: the demo has none.
      shimModules({ "src/server/settings/secrets.ts": "site/src/shims/secrets.ts" }),
      guard(),
      react(),
      headScript(THEME_SCRIPT),
      pagesFallback({ base: BASE, outDir: OUT }),
    ],
    css: {
      postcss: { plugins: [tailwindcss({ base: REPO })] },
    },
    // Workers are bundled with their own plugin list: guard them too.
    worker: { format: "es", plugins: () => [guard()] },
    optimizeDeps: {
      // PGlite loads its WebAssembly relative to its own files.
      exclude: ["@electric-sql/pglite"],
    },
    build: {
      outDir: OUT,
      emptyOutDir: true,
      target: "es2022",
      // The app chunk carries the whole studio, its router and the PGlite
      // client (≈ 370 kB gzipped); Postgres itself loads in the worker.
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        onwarn(warning, warn) {
          // PGlite's Emscripten glue uses eval on purpose.
          if (warning.code === "EVAL" && warning.id?.includes("@electric-sql/pglite")) return;
          warn(warning);
        },
        input: {
          landing: resolve(SITE, "index.html"),
          app: resolve(SITE, "app/index.html"),
        },
      },
    },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
  };
});
