import cliPackage from "../package.json" with { type: "json" };

// The bundle's build (cli/build.mjs) writes the released version here from
// TROUPE_VERSION; run from source, the CLI reports cli/package.json's.
declare const __TROUPE_VERSION__: string | undefined;

export const VERSION: string = typeof __TROUPE_VERSION__ === "string" ? __TROUPE_VERSION__ : cliPackage.version;
export const USER_AGENT = `troupe-cli/${VERSION}`;
