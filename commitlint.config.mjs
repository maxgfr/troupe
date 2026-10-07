// Commit messages follow Conventional Commits (CONTRIBUTING.md#commit-messages):
// semantic-release reads them to choose each release's version and write its
// notes. ci.yml's `commits` job checks every commit after v0.2.0; locally:
//
//   pnpm lint:commits                  # the commits on this branch, against origin/main
//   echo "feat: add a voice" | pnpm exec commitlint
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Bodies and footers wrap where they like: links, quoted output and
    // Dependabot's release notes run long.
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
