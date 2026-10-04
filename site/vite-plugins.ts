import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join, relative, resolve } from "node:path";
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

// Fails the build when code from src/ or site/ pulls in Node built-ins,
// server packages, Next internals other than the shimmed link/navigation, or
// a module marked `import "server-only"`. Dependencies in node_modules are
// left to Vite, which already refuses Node built-ins in a browser build.
export function serverGuard(): Plugin {
  return {
    name: "troupe:server-guard",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !ours(importer)) return null;
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
