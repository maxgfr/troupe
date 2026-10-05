import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";

import { actorPictures, actorPicturesMiddleware, landingPage, parseLandingConfig, serverGuard } from "./vite-plugins";

// A throwaway project: an entry that imports one fake dependency.
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(dependency: string, source: string) {
  const dir = mkdtempSync(join(tmpdir(), "troupe-guard-"));
  dirs.push(dir);
  const pkg = join(dir, "node_modules", dependency);
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: dependency, type: "module", main: "index.js" }));
  writeFileSync(join(pkg, "index.js"), source);
  writeFileSync(join(dir, "index.js"), `import value from "${dependency}";\nconsole.log(value);\n`);
  return dir;
}

function bundle(root: string, guard = serverGuard()) {
  return build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [guard],
    build: { write: false, rollupOptions: { input: join(root, "index.js") } },
  });
}

describe("server guard", () => {
  it("fails the build when a dependency imports a node: module", async () => {
    const root = project("leaky", `import { readFileSync } from "node:fs";\nexport default readFileSync;\n`);
    await expect(bundle(root)).rejects.toThrow(/node:fs is a Node built-in \(imported by leaky\)/);
  });

  it("fails the build on a bare built-in such as fs, too", async () => {
    const root = project("leaky-bare", `import fs from "fs";\nexport default fs;\n`);
    await expect(bundle(root)).rejects.toThrow(/fs is a Node built-in \(imported by leaky-bare\)/);
  });

  it("lets a dependency use the built-ins it is allowed, and only those", async () => {
    const root = project("guarded", `import fs from "fs";\nexport default fs;\n`);
    await expect(bundle(root, serverGuard({ nodeBuiltinsAllowedIn: { guarded: { builtins: ["fs"], reason: "test" } } }))).resolves.toBeTruthy();

    const other = project("guarded", `import zlib from "zlib";\nexport default zlib;\n`);
    await expect(bundle(other, serverGuard({ nodeBuiltinsAllowedIn: { guarded: { builtins: ["fs"], reason: "test" } } }))).rejects.toThrow(/zlib is a Node built-in/);
  });
});

describe("actor pictures", () => {
  function cast() {
    const dir = mkdtempSync(join(tmpdir(), "troupe-cast-"));
    dirs.push(dir);
    mkdirSync(join(dir, "cast", "lea-01", "v1"), { recursive: true });
    writeFileSync(join(dir, "cast", "lea-01", "v1", "front.webp"), "RIFF-front");
    writeFileSync(join(dir, "cast", "lea-01", "v1", "notes.txt"), "not for the site");
    writeFileSync(join(dir, "index.js"), "console.log(1);\n");
    return dir;
  }

  it("copies the pictures, and only them, into the build at <base>actors/", async () => {
    const root = cast();
    const outDir = join(root, "dist");
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [actorPictures({ base: "/troupe/", dir: join(root, "cast"), outDir })],
      build: { outDir, rollupOptions: { input: join(root, "index.js") } },
    });
    expect(readFileSync(join(outDir, "actors", "lea-01", "v1", "front.webp"), "utf8")).toBe("RIFF-front");
    expect(existsSync(join(outDir, "actors", "lea-01", "v1", "notes.txt"))).toBe(false);
  });

  it("stops the build when the pictures folder is missing", async () => {
    const root = cast();
    const outDir = join(root, "dist");
    await expect(
      build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [actorPictures({ base: "/troupe/", dir: join(root, "nowhere"), outDir })],
        build: { outDir, rollupOptions: { input: join(root, "index.js") } },
      }),
    ).rejects.toThrow(/pictures folder .*nowhere does not exist/);
  });
});

describe("actor pictures in vite dev", () => {
  function serve(url: string) {
    const root = mkdtempSync(join(tmpdir(), "troupe-cast-dev-"));
    dirs.push(root);
    mkdirSync(join(root, "lea-01", "v1"), { recursive: true });
    writeFileSync(join(root, "lea-01", "v1", "front.webp"), "RIFF-front");
    writeFileSync(join(root, "secret.txt"), "no");
    const sent: { type?: string; body?: string; next: boolean } = { next: false };
    const res = { setHeader: (_: string, v: string) => (sent.type = v), end: (b: Buffer) => (sent.body = b.toString()) };
    actorPicturesMiddleware("/troupe/", root)({ url } as never, res as never, () => (sent.next = true));
    return sent;
  }

  it("serves a picture with its type", () => {
    expect(serve("/troupe/actors/lea-01/v1/front.webp?x=1")).toEqual({ type: "image/webp", body: "RIFF-front", next: false });
  });

  it("passes anything else on: other paths, other files, escapes and malformed URLs", () => {
    for (const url of ["/troupe/app/", "/troupe/actors/secret.txt", "/troupe/actors/..%2F..%2Fetc%2Fpasswd.webp", "/troupe/actors/%E0%A4%A.webp"]) {
      expect(serve(url), url).toEqual({ next: true });
    }
  });
});

describe("landing page", () => {
  // A landing page and another page, built the way the site builds them.
  async function site(html: string) {
    // The real path: Vite names pages from it (macOS's tmpdir is a symlink).
    const root = realpathSync(mkdtempSync(join(tmpdir(), "troupe-landing-")));
    dirs.push(root);
    writeFileSync(join(root, "index.html"), html);
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "app", "index.html"), "<!doctype html><html><head><title>%SITE_URL%</title></head><body><!--troupe:cast--></body></html>");
    // Léa has thumbnails, Sam only the full picture.
    const portraits = join(root, "cast");
    mkdirSync(join(portraits, "lea-01", "v1"), { recursive: true });
    mkdirSync(join(portraits, "sam-13", "v1"), { recursive: true });
    for (const file of ["front.webp", "front-160.webp", "front-320.webp"]) writeFileSync(join(portraits, "lea-01", "v1", file), "RIFF");
    writeFileSync(join(portraits, "sam-13", "v1", "front.webp"), "RIFF");
    const outDir = join(root, "dist");
    await build({
      root,
      base: "/troupe/",
      configFile: false,
      logLevel: "silent",
      plugins: [
        landingPage({
          base: "/troupe/",
          siteUrl: "https://example.org/troupe/",
          repoUrl: "https://git.example.org/me/troupe",
          portraitsDir: portraits,
          cast: [
            { slug: "lea-01", name: "Léa" },
            { slug: "sam-13", name: "Sam & <co>" },
          ],
        }),
      ],
      build: { outDir, rollupOptions: { input: { landing: join(root, "index.html"), app: join(root, "app", "index.html") } } },
    });
    return { landing: readFileSync(join(outDir, "index.html"), "utf8"), app: readFileSync(join(outDir, "app", "index.html"), "utf8") };
  }

  it("fills in the site's address and the repository's, on the landing page only", async () => {
    const { landing, app } = await site(
      '<!doctype html><html><head><meta property="og:image" content="%SITE_URL%social.png" /><link rel="canonical" href="%SITE_URL%" /></head><body><a href="%REPO_URL%/blob/main/docs/SELF-HOSTING.md">Guide</a><a href="%BASE%app/">App</a></body></html>',
    );
    expect(landing).toContain('<meta property="og:image" content="https://example.org/troupe/social.png" />');
    expect(landing).toContain('<link rel="canonical" href="https://example.org/troupe/" />');
    expect(landing).toContain('href="https://git.example.org/me/troupe/blob/main/docs/SELF-HOSTING.md"');
    expect(landing).toContain('href="/troupe/app/"');
    expect(app).toContain("<title>%SITE_URL%</title>");
  });

  it("lists the cast from the catalog, with the pictures the site serves", async () => {
    const { landing, app } = await site("<!doctype html><html><head></head><body><ul><!--troupe:cast--></ul></body></html>");
    // Thumbnails when the cast folder has them, the full picture otherwise.
    expect(landing).toContain(
      '<img src="/troupe/actors/lea-01/v1/front-320.webp" srcset="/troupe/actors/lea-01/v1/front-160.webp 160w, /troupe/actors/lea-01/v1/front-320.webp 320w, /troupe/actors/lea-01/v1/front.webp 768w" sizes="(min-width: 1240px) 106px, (min-width: 720px) 14vw, 30vw" alt="" width="768" height="768" loading="lazy" decoding="async" />',
    );
    expect(landing).toContain('<img src="/troupe/actors/sam-13/v1/front.webp" alt="" width="768" height="768" loading="lazy" decoding="async" />');
    expect(landing).toContain("<span>Léa</span>");
    // Names are text, never markup.
    expect(landing).toContain("<span>Sam &amp; &lt;co&gt;</span>");
    expect(landing.match(/<li>/g)).toHaveLength(2);
    expect(app).toContain("<!--troupe:cast-->");
  });

  it("points %ACTOR_THUMB:<slug>% at the smallest picture the cast folder has", async () => {
    const { landing } = await site('<!doctype html><html><head></head><body><img src="%ACTOR_THUMB:lea-01%" alt="" /><img src="%ACTOR_THUMB:sam-13%" alt="" /></body></html>');
    expect(landing).toContain('<img src="/troupe/actors/lea-01/v1/front-160.webp" alt="" />');
    expect(landing).toContain('<img src="/troupe/actors/sam-13/v1/front.webp" alt="" />');
  });
});

describe("landing page settings", () => {
  it("defaults to the project's own addresses", () => {
    expect(parseLandingConfig({})).toEqual({ siteUrl: "https://maxgfr.github.io/troupe/", repoUrl: "https://github.com/maxgfr/troupe" });
  });

  it("takes a fork's addresses, normalised", () => {
    expect(parseLandingConfig({ VITE_SITE_URL: "https://me.github.io/studio", VITE_REPO_URL: "https://github.com/me/studio/" })).toEqual({
      siteUrl: "https://me.github.io/studio/",
      repoUrl: "https://github.com/me/studio",
    });
  });

  it("refuses an address that is not an absolute http(s) URL", () => {
    expect(() => parseLandingConfig({ VITE_SITE_URL: "/troupe/" })).toThrow(/VITE_SITE_URL/);
    expect(() => parseLandingConfig({ VITE_REPO_URL: "javascript:alert(1)" })).toThrow(/VITE_REPO_URL/);
  });
});
