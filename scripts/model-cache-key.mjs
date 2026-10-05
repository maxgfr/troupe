// The part of CI's cache keys for downloaded model weights (the render test's
// browser profile, the Docker e2e run's model folder) that tracks the
// packages fetching and storing them: kokoro-js, Transformers.js, and
// Playwright, whose Chromium owns the profile. The rest of the lockfile
// changing does not throw the weights away. Prints e.g.
// kokoro-js@1.2.1-@huggingface+transformers@3.8.1-@playwright+test@1.63.0
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGES = ["kokoro-js", "@huggingface/transformers", "@playwright/test"];
const root = join(import.meta.dirname, "..");
const version = (name) => JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")).version;
console.log(PACKAGES.map((name) => `${name.replace("/", "+")}@${version(name)}`).join("-"));
