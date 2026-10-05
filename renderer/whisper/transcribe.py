"""Troupe's transcription for the inspiration library (renderer/src/whisper.ts).

Transcribes one audio file with faster-whisper and prints one JSON object on
stdout: {"language", "model", "duration", "segments": [{"start", "end", "text"}]}.
`--download` only fetches the model (pnpm renderer:whisper:setup). The
weights come from the Hugging Face Hub (Systran/faster-whisper-<size>, MIT)
into HF_HOME, once.
"""

import argparse
import json
import sys

from faster_whisper import WhisperModel


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", nargs="?", help="The audio file (any format FFmpeg reads).")
    parser.add_argument("--model", default="base", help="tiny, base, small, medium, large-v3, turbo, or a CTranslate2 model path.")
    parser.add_argument("--device", default="cpu", help="cpu, cuda or auto.")
    parser.add_argument("--compute-type", default="int8", help="int8, int8_float16, float16 or float32.")
    parser.add_argument("--threads", type=int, default=0, help="CPU threads (0: CTranslate2's default).")
    parser.add_argument("--language", default=None, help="An ISO 639-1 code; detected when omitted.")
    parser.add_argument("--download", action="store_true", help="Only download the model.")
    args = parser.parse_args()

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type, cpu_threads=args.threads)
    if args.download:
        json.dump({"ok": True, "model": args.model}, sys.stdout)
        return 0
    if not args.audio:
        parser.error("the audio file is missing")

    segments, info = model.transcribe(args.audio, language=args.language or None, vad_filter=True, beam_size=5)
    out = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments if s.text.strip()]
    json.dump({"language": info.language, "model": f"faster-whisper {args.model}", "duration": round(info.duration, 2), "segments": out}, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
