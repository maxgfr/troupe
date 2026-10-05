import { copyFileSync, cpSync, existsSync, readFileSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { extname, join, relative, resolve, sep } from "node:path";
import type { Connect, Plugin } from "vite";

// Vite plugins for the browser edition: keep server code out of the bundle,
// swap the few Node-only modules for browser stand-ins, and serve deep links
// the way GitHub Pages does.

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

// `vite dev`: answers <base>actors/<file> with that picture from `dir`, and
// passes everything else (other paths and files, escapes, malformed URLs) on.
export function actorPicturesMiddleware(base: string, dir: string): Connect.NextHandleFunction {
  const prefix = `${base}actors/`;
  const root = resolve(dir);
  return (req, res, next) => {
    let path: string;
    try {
      path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    } catch {
      return next();
    }
    if (!path.startsWith(prefix)) return next();
    const file = resolve(root, path.slice(prefix.length));
    const type = pictureType(file);
    if (!type || !file.startsWith(`${root}${sep}`) || !existsSync(file) || !statSync(file).isFile()) return next();
    res.setHeader("Content-Type", type);
    res.end(readFileSync(file));
  };
}

// The actors' pictures live once in the repository, in public/actors (the
// self-hosted app serves them from there). The site serves the same folder,
// or `dir` when set, at <base>actors/: `vite dev` reads it in place and the
// build copies it into the output.
export function actorPictures({ base, dir, outDir }: { base: string; dir: string; outDir: string }): Plugin {
  return {
    name: "troupe:actor-pictures",
    configureServer(server) {
      server.middlewares.use(actorPicturesMiddleware(base, dir));
    },
    writeBundle() {
      if (!existsSync(dir)) this.error(`The actors' pictures folder ${dir} does not exist (VITE_PORTRAITS_DIR).`);
      // Pictures only: no stray notes or .DS_Store files on the site.
      cpSync(dir, join(outDir, "actors"), { recursive: true, filter: (from) => statSync(from).isDirectory() || pictureType(from) !== undefined });
    },
  };
}

// The landing page's addresses: where the site is published (canonical link,
// social preview) and the repository its docs links point at. A fork sets
// VITE_SITE_URL and VITE_REPO_URL (site/.env.example).
export interface LandingConfig {
  siteUrl: string;
  repoUrl: string;
}

function absoluteUrl(name: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL, got "${value}".`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${name} must be an absolute http(s) URL, got "${value}".`);
  return url;
}

export function parseLandingConfig(env: Record<string, string | undefined>): LandingConfig {
  const site = absoluteUrl("VITE_SITE_URL", env.VITE_SITE_URL || "https://maxgfr.github.io/troupe/");
  const repo = absoluteUrl("VITE_REPO_URL", env.VITE_REPO_URL || "https://github.com/maxgfr/troupe");
  return { siteUrl: site.href.endsWith("/") ? site.href : `${site.href}/`, repoUrl: repo.href.replace(/\/+$/, "") };
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The landing page (the site's root index.html). Before Vite reads the page,
// %SITE_URL%, %REPO_URL% and %BASE% become the configured addresses and
// %ACTOR_THUMB:<slug>% that actor's smallest picture. After Vite's asset pass
// (which would look for the pictures among the sources), <!--troupe:cast-->
// becomes the cast, one <li> per actor. Pictures come from <base>actors/: the
// thumbnails (front-160.webp, front-320.webp, made by
// scripts/actors/thumbnails.sh) when the cast folder has them, the full front
// picture otherwise. Other pages are left alone.
const THUMBS = [160, 320] as const;
// The cast grid's tile width (site/src/landing/landing.css).
const CAST_SIZES = "(min-width: 1240px) 106px, (min-width: 720px) 14vw, 30vw";

export function landingPage({
  base,
  siteUrl,
  repoUrl,
  portraitsDir,
  cast,
}: LandingConfig & { base: string; portraitsDir: string; cast: { slug: string; name: string }[] }): Plugin[] {
  const isLanding = (path: string) => path === "/index.html";
  const url = (slug: string, file: string) => `${base}actors/${encodeURIComponent(slug)}/v1/${file}`;
  const hasThumbs = (slug: string) => THUMBS.every((w) => existsSync(join(portraitsDir, slug, "v1", `front-${w}.webp`)));
  const picture = (slug: string) =>
    hasThumbs(slug)
      ? `<img src="${url(slug, "front-320.webp")}" srcset="${THUMBS.map((w) => `${url(slug, `front-${w}.webp`)} ${w}w`).join(", ")}, ${url(slug, "front.webp")} 768w" sizes="${CAST_SIZES}" alt="" width="768" height="768" loading="lazy" decoding="async" />`
      : `<img src="${url(slug, "front.webp")}" alt="" width="768" height="768" loading="lazy" decoding="async" />`;
  return [
    {
      name: "troupe:landing-addresses",
      transformIndexHtml: {
        order: "pre",
        handler: (html, { path }) =>
          isLanding(path)
            ? html
                .replaceAll("%SITE_URL%", siteUrl)
                .replaceAll("%REPO_URL%", repoUrl)
                .replaceAll("%BASE%", base)
                .replace(/%ACTOR_THUMB:([a-z0-9-]+)%/g, (_, slug: string) => url(slug, hasThumbs(slug) ? "front-160.webp" : "front.webp"))
            : html,
      },
    },
    {
      name: "troupe:landing-cast",
      transformIndexHtml: {
        order: "post",
        handler: (html, { path }) => (isLanding(path) ? html.replace("<!--troupe:cast-->", cast.map(({ slug, name }) => `<li>${picture(slug)}<span>${escapeHtml(name)}</span></li>`).join("")) : html),
      },
    },
  ];
}
