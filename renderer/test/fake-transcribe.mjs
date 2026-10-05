// Stands in for renderer/whisper/transcribe.py in tests: takes the same
// arguments, checks the audio file arrived whole, and prints the same JSON,
// so transcription is tested without Python or model weights.
//
//   node fake-transcribe.mjs <audio> --model base ... [--fail "message"]
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
if (value("--fail")) {
  process.stderr.write(`Traceback (most recent call last):\nRuntimeError: ${value("--fail")}\n`);
  process.exit(1);
}
const audio = readFileSync(args[0]);
process.stdout.write(JSON.stringify({ language: "en", model: `faster-whisper ${value("--model")}`, duration: 2, segments: [{ start: 0, end: 2, text: `${audio.length} bytes, threads ${value("--threads")}` }] }));
