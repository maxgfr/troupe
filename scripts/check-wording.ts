// `pnpm check:wording` (part of `pnpm lint`): fails when the repository says
// "d-e-m-o", in any case, in a file's path or in its content. The static site
// is Troupe itself, its browser edition, and the video is the presentation
// tour: nothing here is a cut-down version of the product. The word is spelled
// d[e]mo below so this file passes its own check.
//
// It reads every file git tracks or would track (untracked files that are not
// ignored), so a new file is caught before it is committed. Text files are
// read whole; in a binary file (a NUL byte in its first 8 KB, as git decides)
// only runs of 8 or more printable characters count, which is where metadata
// such as an image's comment sits, so compressed bytes that happen to spell
// the word do not fail the check.
//
// Allowed, and only these:
// - drizzle/0019_generation-progress.sql: a shipped migration, which must stay
//   byte-identical (drizzle checks each migration's hash);
// - pnpm-lock.yaml: integrity hashes (base64 that spells anything).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..");
const WORD = /d[e]mo/i;
const ALLOWED_FILES = new Set(["drizzle/0019_generation-progress.sql"]);
const INTEGRITY = /sha512-[A-Za-z0-9+/]+=*/g;
const PRINTABLE_RUN = /[\x20-\x7e]{8,}/g;

const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: REPO, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const hits: string[] = [];
for (const file of new Set(files)) {
  if (ALLOWED_FILES.has(file)) continue;
  if (WORD.test(file)) hits.push(`${file}: in the file's path`);
  let bytes: Buffer;
  try {
    bytes = readFileSync(resolve(REPO, file));
  } catch {
    continue; // Deleted in the working tree, not yet in the index.
  }
  if (bytes.subarray(0, 8000).includes(0)) {
    for (const [run] of bytes.toString("latin1").matchAll(PRINTABLE_RUN)) {
      if (WORD.test(run)) hits.push(`${file}: in its binary content, "${run.slice(0, 120)}"`);
    }
    continue;
  }
  const lines = bytes.toString("utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    const text = file === "pnpm-lock.yaml" ? line.replace(INTEGRITY, "") : line;
    if (WORD.test(text)) hits.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}`);
  }
}

if (hits.length > 0) {
  console.error(`The repository must not say d[e]mo (scripts/check-wording.ts). Found ${hits.length}:`);
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
console.log(`check:wording: ${new Set(files).size} files, none says d[e]mo.`);
