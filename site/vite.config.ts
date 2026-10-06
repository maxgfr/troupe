import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type UserConfig } from "vite";

import { THEME_SCRIPT } from "../src/app/theme-script";
import { ACTOR_CATALOG } from "../src/modules/actors/server/catalog";
import { parseChatConfig } from "./src/chat/config";
import { parseLibraryConfig } from "./src/library/config";
import { parseRenderConfig } from "./src/render/config";
import {
  actorPictures,
  fontPreloads,
  headScript,
  landingPage,
  pagesFallback,
  parseBasePath,
  parseLandingConfig,
  serverGuard,
  shimModules,
} from "./vite-plugins";

// The browser edition: the studio's own pages and tRPC router, running in the
// browser on PGlite. Served from https://<user>.github.io/troupe/: the landing
// page at /troupe/, the app at /troupe/app/* (another path with VITE_BASE).
const REPO = resolve(import.meta.dirname, "..");
const SITE = import.meta.dirname;
const OUT = resolve(SITE, "dist");

// The browser bundle may not pull in Node built-ins, server code or Next
// internals (site/vite-plugins.ts).
const guard = () =>
  serverGuard({
    nodeBuiltinsAllowedIn: {
      // PGlite ships one build for Node and browsers: these imports sit on
      // its Node-only paths (file:// data directories, Emscripten's Node
      // loader, dump compression) and never run with idb:// in a browser.
      "@electric-sql/pglite": {
        builtins: ["fs", "fs/promises", "path", "module", "stream", "stream/promises", "util", "zlib"],
        reason: "Node-only code paths",
      },
      // Under Node, kokoro-js reads its voices from disk. Its package.json
      // maps both modules to nothing for browsers, where it fetches the
      // voices instead (checking that readFile exists first).
      "kokoro-js": { builtins: ["path", "fs/promises"], reason: "Node-only voice files" },
    },
  });

export default defineConfig(async ({ mode }): Promise<UserConfig> => {
  // The renderer's VITE_* settings (site/.env.example): a bad value stops
  // the build here rather than a render in a visitor's browser.
  // The studio's tables come from drizzle/*.sql (src/db/migrations.ts): a
  // build without them would ship a studio that cannot start.
  if (!readdirSync(resolve(REPO, "drizzle")).some((file) => file.endsWith(".sql")))
    throw new Error("drizzle/*.sql is missing: the browser edition needs the migrations.");
  const env = loadEnv(mode, SITE, "VITE_");
  const BASE = parseBasePath(env.VITE_BASE);
  parseRenderConfig(env);
  // WebLLM's model list, read here so the page never loads WebLLM just to
  // check the build's model id.
  const { prebuiltAppConfig } = await import("@mlc-ai/web-llm");
  const chatConfig = parseChatConfig(
    env,
    prebuiltAppConfig.model_list.map((m) => m.model_id),
  );
  const libraryConfig = parseLibraryConfig(env);
  // The actors' pictures: the cast checked in for the self-hosted app, or
  // another folder laid out the same way (<slug>/v1/front.webp, …).
  const portraitsDir = resolve(REPO, env.VITE_PORTRAITS_DIR || "public/actors");
  // Where the site is published and the repository its links point at.
  const landing = parseLandingConfig(env);
  return {
    root: SITE,
    base: BASE,
    appType: "mpa",
    define: { __CHAT_CONFIG__: JSON.stringify(chatConfig), __LIBRARY_CONFIG__: JSON.stringify(libraryConfig) },
    publicDir: resolve(SITE, "public"),
    resolve: {
      alias: [
        { find: /^~\//, replacement: `${resolve(REPO, "src")}/` },
        { find: /^next\/link$/, replacement: resolve(SITE, "src/shims/next-link.tsx") },
        { find: /^next\/navigation$/, replacement: resolve(SITE, "src/shims/next-navigation.ts") },
      ],
    },
    plugins: [
      // Saving secrets needs a key kept on a server: the browser edition has
      // none.
      shimModules({ "src/server/settings/secrets.ts": "site/src/shims/secrets.ts" }),
      guard(),
      react(),
      headScript(THEME_SCRIPT),
      fontPreloads({ base: BASE, match: [/geist-latin-wght-normal/, /bricolage-grotesque-latin-wght-normal/] }),
      pagesFallback({ base: BASE, outDir: OUT }),
      actorPictures({ base: BASE, dir: portraitsDir, outDir: OUT }),
      landingPage({ base: BASE, ...landing, portraitsDir, cast: ACTOR_CATALOG }),
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
