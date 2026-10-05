import { copyFileSync, cpSync, existsSync, readFileSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { extname, join, relative, resolve, sep } from "node:path";
import type { Connect, Plugin } from "vite";

// Vite plugins for the static demo: keep server code out of the bundle, swap
// the few Node-only modules for browser stand-ins, and serve deep links the
// way GitHub Pages does.

const REPO = resolve(import.meta.dirname, "..");
const ours = (file: string) => file.startsWith(REPO) && !file.includes("/node_modules/");
const show = (file: string) => relative(REPO, file);

// Packages that only make sense on a server. `server-only` marks a module
// that must never reach a browser, so importing it is an error here too.
const SERVER_PACKAGES = new Set(["postgres", "@supabase/supabase-js", "@t3-oss/env-nextjs", "server-only"]);

// The package a file in node_modules belongs to ("@scope/name" or "name").
function packageOf(file: string): string {
  const parts = file.slice(file.lastIndexOf("/node_modules/") + "/node_modules/".length).split("/");
  return parts[0]!.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]!;
}

export interface ServerGuardOptions {
  // Dependencies allowed to import some Node built-ins, each with the reason.
  nodeBuiltinsAllowedIn?: Record<string, { builtins: string[]; reason: string }>;
}

// Fails the build when anything bundled for the browser imports a Node
// built-in (`node:fs` or bare `fs`), unless that dependency is allowed that
// built-in. Vite would otherwise swap it for an empty `__vite-browser-external`
// stub that throws only when used, and say nothing. Code from src/ or site/
// is also refused server packages, Next modules other than the shimmed
// link/navigation, and modules marked `import "server-only"`.
export function serverGuard({ nodeBuiltinsAllowedIn = {} }: ServerGuardOptions = {}): Plugin {
  return {
    name: "troupe:server-guard",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer) return null;
      if (!ours(importer)) {
        if (!isBuiltin(source)) return null;
        const owner = packageOf(importer);
        const allowed = nodeBuiltinsAllowedIn[owner]?.builtins.includes(source.replace(/^node:/, ""));
        if (!allowed) this.error(`${source} is a Node built-in (imported by ${owner}). Allow it in site/vite.config.ts with a reason, or keep the dependency out of the browser bundle.`);
        return null;
      }
      const name = source.startsWith("@") ? source.split("/").slice(0, 2).join("/") : source.split("/")[0]!;
      const reason = isBuiltin(source)
        ? "is a Node built-in"
        : SERVER_PACKAGES.has(name)
          ? "is a server package"
          : name === "next"
            ? "is a Next.js module without a shim"
            : null;
      if (reason) this.error(`${source} ${reason} (imported by ${show(importer)}). Shim it in site/vite.config.ts or pass it through the request context.`);
      return null;
    },
    transform(code, id) {
      if (ours(id) && /^\s*import\s+["']server-only["']/m.test(code)) {
        this.error(`${show(id)} is marked server-only and cannot be bundled for the browser.`);
      }
      return null;
    },
  };
}

// Replaces whole modules, matched by resolved file so that relative imports
// (`./secrets`) are caught as well as `~/server/settings/secrets`.
export function shimModules(shims: Record<string, string>): Plugin {
  const byFile = new Map(Object.entries(shims).map(([from, to]) => [resolve(REPO, from), resolve(REPO, to)]));
  return {
    name: "troupe:shim-modules",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !ours(importer)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      const shim = resolved && byFile.get(resolved.id.split("?")[0]!);
      return shim && shim !== importer ? shim : null;
    },
  };
}

// Inlines a script at the top of <head>, before any stylesheet or paint.
export function headScript(script: string): Plugin {
  return {
    name: "troupe:head-script",
    transformIndexHtml: () => [{ tag: "script", children: script, injectTo: "head-prepend" }],
  };
}

// GitHub Pages has no rewrites: an unknown path such as
// /troupe/app/projects/<id> gets 404.html, so 404.html is the app itself.
// `vite dev` rewrites app paths to the app; `vite preview` answers like Pages.
export function pagesFallback({ base, outDir }: { base: string; outDir: string }): Plugin {
  const app = `${base}app/`;
  const isAppRoute = (url: string) => url.startsWith(app) && !/\.[a-z0-9]+$/i.test(url.split("?")[0]!);
  return {
    name: "troupe:pages-fallback",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && isAppRoute(req.url) && req.url.split("?")[0] !== app) req.url = `${app}index.html`;
        next();
      });
    },
    configurePreviewServer(server) {
      const notFound: Connect.NextHandleFunction = (req, res, next) => {
        const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
        if (!path.startsWith(base)) return next();
        const file = join(outDir, path.slice(base.length));
        const exists = existsSync(file) && (statSync(file).isFile() || existsSync(join(file, "index.html")));
        if (exists) return next();
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(readFileSync(join(outDir, "404.html")));
      };
      server.middlewares.use(notFound);
    },
    closeBundle() {
      const index = join(outDir, "app", "index.html");
      if (existsSync(index)) copyFileSync(index, join(outDir, "404.html"));
    },
  };
}

const PICTURE_TYPES: Record<string, string> = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const pictureType = (file: string): string | undefined => PICTURE_TYPES[extname(file).toLowerCase()];

// The actors' pictures live once in the repository, in public/actors (the
// self-hosted app serves them from there). The site serves the same folder,
// or `dir` when set, at <base>actors/: `vite dev` reads it in place and the
// build copies it into the output.
export function actorPictures({ base, dir, outDir }: { base: string; dir: string; outDir: string }): Plugin {
  const prefix = `${base}actors/`;
  return {
    name: "troupe:actor-pictures",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
        if (!path.startsWith(prefix)) return next();
        const file = resolve(dir, path.slice(prefix.length));
        const type = pictureType(file);
        if (!type || !file.startsWith(`${resolve(dir)}${sep}`) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("Content-Type", type);
        res.end(readFileSync(file));
      });
    },
    writeBundle() {
      if (!existsSync(dir)) this.error(`The actors' pictures folder ${dir} does not exist (VITE_PORTRAITS_DIR).`);
      // Pictures only: no stray notes or .DS_Store files on the site.
      cpSync(dir, join(outDir, "actors"), { recursive: true, filter: (from) => statSync(from).isDirectory() || pictureType(from) !== undefined });
    },
  };
}
