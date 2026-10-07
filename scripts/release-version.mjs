// The version a build of Troupe reports. Releases are git tags and GitHub
// Releases made by semantic-release (CONTRIBUTING.md#releases): no commit
// bumps the package.json files, which keep the last version set by hand. The
// release workflow passes the released version as TROUPE_VERSION instead: a
// build argument of every image (and their environment), and the CLI
// bundle's build. It wins when it is a version; anything else (unset, empty,
// or Compose's image tag `latest`) falls back to package.json's.

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * @param {string | undefined} candidate TROUPE_VERSION, with or without a leading "v".
 * @param {string} fallback The package.json version.
 * @returns {string}
 */
export function releaseVersion(candidate, fallback) {
  const version = candidate?.trim().replace(/^v/, "");
  return version && SEMVER.test(version) ? version : fallback;
}
