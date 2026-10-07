// Records each actor's voice sample: one line from scripts/actors/cast.json,
// read by Kokoro-82M with the voice and speed the renderers cast for that
// actor (voiceFor in src/modules/scene, the model setup of
// renderer/src/kokoro.ts), then encoded twice beside the pictures:
// <actor>/v1/voice.webm (Opus) and voice.m4a (AAC, for Safari without Opus
// in WebM). What was used is written to scripts/actors/voices.json (or the
// --dir folder's voices.json).
//
//   pnpm actors:voices                         # every actor, into public/actors
//   pnpm actors:voices --only aiko-03,tom-23   # some of them again
//   pnpm actors:voices --dir /path/to/cast     # another cast folder
//
// Needs ffmpeg (with libopus) on the PATH. The weights download once into
// KOKORO_CACHE (default ~/.cache/troupe-renderer, shared with the renderer);
// KOKORO_DTYPE and KOKORO_VOICES work as for the renderer (docs/ACTORS.md).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { KOKORO_MODEL, kokoroVoice, parseKokoroDtype } from "../../renderer/src/kokoro";
import { ACTOR_CATALOG } from "../../src/modules/actors/server/catalog";
import { KOKORO_VOICES, parseVoicePools, voiceFor, type VoicePools } from "../../src/modules/scene/voice";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// The emotion the sample is read with: the renderers' plain delivery.
const EMOTION = "neutral" as const;

// Opus at 24 kb/s and AAC-LC at 32 kb/s, mono at Kokoro's 24 kHz: about
// 11 KB and 16 KB for a 3.5 s line. Loudness evened out so every sample
// plays at the same level. Bit-exact muxing keeps reruns byte-identical.
const LOUDNESS = "loudnorm=I=-18:TP=-1.5:LRA=11";
const ENCODINGS = [
  { file: "voice.webm", args: ["-c:a", "libopus", "-b:a", "24k", "-application", "voip", "-f", "webm"] },
  { file: "voice.m4a", args: ["-c:a", "aac", "-b:a", "32k", "-movflags", "+faststart", "-f", "mp4"] },
] as const;

interface Sample {
  voice: string;
  speed: number;
  text: string;
  durationS: number;
}

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function wav(samples: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (const [i, s] of samples.entries()) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function encode(input: string, output: string, args: readonly string[], sampleRate: number) {
  execFileSync(
    "ffmpeg",
    [
      ...["-hide_banner", "-loglevel", "error", "-y", "-i", input],
      ...["-af", LOUDNESS, "-ar", String(sampleRate), "-ac", "1"],
      ...["-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact"],
      ...args,
      output,
    ],
    { stdio: "inherit" },
  );
}

function voicePools(): { pools: VoicePools; map: string } {
  const pools = process.env.KOKORO_VOICES ? parseVoicePools(process.env.KOKORO_VOICES) : KOKORO_VOICES;
  return { pools, map: `female=${pools.female.join(",")};male=${pools.male.join(",")}` };
}

async function main() {
  const dir = resolve(ROOT, option("dir") ?? "public/actors");
  // The checked-in cast's settings sit beside cast.json; another cast's in
  // its own folder.
  const MANIFEST = option("dir") ? join(dir, "voices.json") : join(ROOT, "scripts/actors/voices.json");
  const only = option("only")
    ?.split(",")
    .map((s) => s.trim());
  const dtype = parseKokoroDtype(process.env.KOKORO_DTYPE);
  const { pools, map } = voicePools();
  const lines = JSON.parse(readFileSync(join(ROOT, "scripts/actors/cast.json"), "utf8")) as Record<
    string,
    { line?: string }
  >;
  const cast = ACTOR_CATALOG.filter((a) => !only || only.includes(a.slug));
  if (only && cast.length !== only.length) {
    throw new Error(`Not in the catalog: ${only.filter((s) => !cast.some((a) => a.slug === s)).join(", ")}`);
  }
  if (!execFileSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }).includes("libopus"))
    throw new Error("ffmpeg has no libopus encoder: install an ffmpeg built with it (brew install ffmpeg).");

  const kokoroJs = JSON.parse(readFileSync(join(ROOT, "renderer/node_modules/kokoro-js/package.json"), "utf8")) as {
    version: string;
  };
  const kokoro = kokoroVoice({
    cacheDir: process.env.KOKORO_CACHE ?? join(homedir(), ".cache", "troupe-renderer"),
    dtype,
    log: console.log,
  });
  const previous =
    only && existsSync(MANIFEST)
      ? (JSON.parse(readFileSync(MANIFEST, "utf8")) as { actors: Record<string, Sample> }).actors
      : {};
  const samples: Record<string, Sample> = { ...previous };
  const work = mkdtempSync(join(tmpdir(), "troupe-voices-"));
  try {
    for (const actor of cast) {
      const text = lines[actor.slug]?.line ?? `Hi, I'm ${actor.name}. This is how I sound.`;
      if (!pools.female.includes(actor.voice) && !pools.male.includes(actor.voice)) {
        console.warn(
          `${actor.slug}: ${actor.voice} is not in KOKORO_VOICES, so the renderers pick another voice per install; this sample cannot match it.`,
        );
      }
      // The catalog's slug stands in for the database id, which only
      // matters when the pools leave out the actor's own voice.
      const choice = voiceFor(
        { id: actor.slug, gender: actor.gender, voiceProfile: actor.voiceProfile, voice: actor.voice },
        EMOTION,
        pools,
      );
      const speech = await kokoro.speak(text, choice);
      const source = join(work, `${actor.slug}.wav`);
      writeFileSync(source, wav(speech.samples, speech.sampleRate));
      const folder = join(dir, actor.slug, "v1");
      mkdirSync(folder, { recursive: true });
      const sizes = ENCODINGS.map(({ file, args }) => {
        encode(source, join(folder, file), args, speech.sampleRate);
        return `${file} ${(statSync(join(folder, file)).size / 1024).toFixed(1)} KB`;
      });
      const durationS = Math.round((speech.samples.length / speech.sampleRate) * 100) / 100;
      samples[actor.slug] = { ...choice, text, durationS };
      console.log(`${actor.slug}: ${choice.voice} ×${choice.speed}, ${durationS} s, ${sizes.join(", ")}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const ordered = Object.fromEntries(
    ACTOR_CATALOG.filter((a) => samples[a.slug]).map((a) => [a.slug, samples[a.slug]!]),
  );
  const manifest = {
    note: "Written by scripts/actors/voices.ts (pnpm actors:voices). Synthetic voices from Kokoro-82M (Apache-2.0).",
    model: KOKORO_MODEL,
    dtype,
    kokoroJs: kokoroJs.version,
    voiceMap: map,
    emotion: EMOTION,
    loudness: LOUDNESS,
    encodings: Object.fromEntries(ENCODINGS.map(({ file, args }) => [file, args.join(" ")])),
    actors: ordered,
  };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${cast.length} samples in ${dir}; settings in ${MANIFEST}`);
}

await main();
