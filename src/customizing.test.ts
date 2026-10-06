import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// docs/CUSTOMIZING.md lists every setting in one place. These checks read the
// code that reads each variable, so a setting added, renamed or removed
// without its line there (or in .env.example) fails the suite.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const sources = (dir: string, extension = /\.(ts|tsx|js|mjs)$/) =>
  readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((file) => extension.test(file) && !/\.test\.|(^|\/)node_modules\//.test(file))
    .map((file) => join(dir, file));
const matches = (text: string, ...patterns: RegExp[]) => new Set(patterns.flatMap((p) => [...text.matchAll(p)].map((m) => m[1]!)));
const sorted = (names: Iterable<string>) => [...names].sort();
const missing = (wanted: Iterable<string>, from: Set<string>) => sorted([...wanted].filter((name) => !from.has(name)));

// Read from the system, not settings of Troupe's own.
const SYSTEM = new Set(["PATH", "HOME", "TMPDIR", "INIT_CWD", "XDG_CONFIG_HOME"]);
// Set by Next.js, Vercel or the toolchain for the studio's server.
const PLATFORM = new Set([...SYSTEM, "NODE_ENV", "NEXT_RUNTIME", "VERCEL", "VERCEL_URL", "PORT", "SKIP_ENV_VALIDATION"]);

// The studio: src/env.js declares every variable the server reads.
const envJs = read("src/env.js");
const APP = matches(envJs.slice(0, envJs.indexOf("runtimeEnv:")), /^ {4}([A-Z][A-Z0-9_]+): z(?:\.|$)/gm);
const serverReads = matches(sources("src").filter((f) => !f.startsWith("src/env.js")).map(read).join("\n"), /\bprocess\.env\.([A-Z][A-Z0-9_]+)/g, /\benv\.([A-Z][A-Z0-9_]+)/g, /\bsource\.([A-Z][A-Z0-9_]+)/g);

// The browser edition: VITE_* variables, read when the site is built.
const SITE = matches(["site/vite.config.ts", "site/vite-plugins.ts", ...sources("site/src")].map(read).join("\n"), /\b(VITE_[A-Z0-9_]*[A-Z0-9])\b/g);

// The local renderer, its AI video mode and its transcription.
const rendererText = [...sources("renderer/src"), "renderer/ltx/generate.py", "renderer/whisper/transcribe.py"].map(read).join("\n");
const RENDERER = new Set(
  [...matches(rendererText, /\bprocess\.env\.([A-Z][A-Z0-9_]+)/g, /\benv\.([A-Z][A-Z0-9_]+)/g, /["']((?:LTX|WHISPER|KOKORO|SCENE)_[A-Z0-9_]+)["']/g, /\benv\(\s*"([A-Z][A-Z0-9_]+)"/g, /os\.environ\.get\(\s*"([A-Z][A-Z0-9_]+)"/g)].filter((name) => !SYSTEM.has(name)),
);

// The CLI.
const CLI = new Set([...matches(sources("cli/src").map(read).join("\n"), /\benv\.([A-Z][A-Z0-9_]+)/g, /\bprocess\.env\.([A-Z][A-Z0-9_]+)/g)].filter((name) => !SYSTEM.has(name)));

// The Docker stack: every ${VARIABLE} Compose substitutes.
const compose = read("docker-compose.yml");
const COMPOSE = matches(["docker-compose.yml", "docker-compose.gpu.yml", "docker-compose.dev.yml"].map(read).join("\n"), /\$\{([A-Z][A-Z0-9_]+)[:}-]/g);

// The settings docs/CUSTOMIZING.md documents: the names in its tables' first column.
const customizing = read("docs/CUSTOMIZING.md");
const DOCUMENTED = matches(customizing, /^\| `([A-Z][A-Z0-9_]+)`/gm);
const rootExample = matches(read(".env.example"), /^#? ?([A-Z][A-Z0-9_]+)=/gm);
const siteExample = matches(read("site/.env.example"), /^#? ?([A-Z][A-Z0-9_]+)=/gm);

// Set by the stack or the platform for the studio, never by hand.
const INTERNAL = new Set(["NODE_ENV", "TROUPE_ACCESS_CODE_SHARE_DIR"]);

describe("docs/CUSTOMIZING.md", () => {
  it("documents every variable the studio, the browser edition, the renderer, the CLI and the Docker stack read", () => {
    const everything = new Set([...APP, ...SITE, ...RENDERER, ...CLI, ...COMPOSE].filter((name) => !INTERNAL.has(name)));
    expect(missing(everything, DOCUMENTED)).toEqual([]);
  });

  it("documents nothing the code no longer reads", () => {
    const read = new Set([...APP, ...SITE, ...RENDERER, ...CLI, ...COMPOSE]);
    expect(missing(DOCUMENTED, read)).toEqual([]);
  });

  it("names each Settings section it describes as the studio titles it", () => {
    const settings = sources("src/app/(app)/settings", /\.tsx$/).map(read).join("\n");
    const titles = matches(settings, /\btitle="([^"]+)"/g);
    const described = matches(customizing, /^### Settings › (.+)$/gm);
    expect(described.size).toBeGreaterThan(0);
    expect(missing(described, titles)).toEqual([]);
  });
});

describe("src/env.js", () => {
  it("declares every variable the studio's server reads", () => {
    expect(missing([...serverReads].filter((name) => !PLATFORM.has(name)), APP)).toEqual([]);
  });
});

describe(".env.example", () => {
  it("lists every studio and Docker setting", () => {
    expect(missing([...APP, ...COMPOSE].filter((name) => !INTERNAL.has(name)), rootExample)).toEqual([]);
  });

  it("site/.env.example lists every browser edition setting", () => {
    expect(missing(SITE, siteExample)).toEqual([]);
  });
});

describe("docker-compose.yml", () => {
  // Meaningless in the stack: Vercel + Supabase settings, and paths and
  // switches the image itself sets.
  const NOT_IN_DOCKER = new Set(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_STORAGE_BUCKET", "RECONCILE_SECRET", "NODE_ENV", "TROUPE_DATA_DIR", "TROUPE_INPROCESS_WORKER", "TROUPE_AUTO_MIGRATE", "FFPROBE_PATH", "FFMPEG_PATH"]);

  it("passes every studio setting on to the app service", () => {
    const app = compose.slice(compose.indexOf("\n  app:"), compose.indexOf("\n  db:"));
    const passed = matches(app, /^ {6}([A-Z][A-Z0-9_]+):/gm);
    expect(missing([...APP].filter((name) => !NOT_IN_DOCKER.has(name)), passed)).toEqual([]);
  });
});
