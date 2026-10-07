// Builds the CLI into one self-contained file, cli/dist/troupe.mjs:
//
//   pnpm --filter troupe-cli build
//   TROUPE_VERSION=1.2.3 pnpm --filter troupe-cli build   # what a release does
//
// The version the bundle reports (--version, its User-Agent) is TROUPE_VERSION
// when that is a version, cli/package.json's otherwise
// (scripts/release-version.mjs).

import { chmod, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import { releaseVersion } from "../scripts/release-version.mjs";

const CLI = fileURLToPath(new URL(".", import.meta.url));

/** @param {{ version?: string, outfile?: string }} [options] */
export async function buildCli(options = {}) {
  const cliPackage = JSON.parse(await readFile(new URL("package.json", import.meta.url), "utf8"));
  const version = releaseVersion(options.version, cliPackage.version);
  const outfile = options.outfile ?? `${CLI}dist/troupe.mjs`;
  await build({
    entryPoints: [`${CLI}src/main.ts`],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile,
    banner: { js: "#!/usr/bin/env node" },
    define: { __TROUPE_VERSION__: JSON.stringify(version) },
    logLevel: "warning",
  });
  await chmod(outfile, 0o755);
  return { version, outfile };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildCli({ version: process.env.TROUPE_VERSION });
}
