import { readFile } from "node:fs/promises";

import type { Transcriber, Transcript } from "~/modules/library";
import { checkLocalUrl } from "~/server/settings/urls";

// Transcription by the stack's renderer, which runs faster-whisper
// (renderer/whisper): POST /transcribe with the sound as FLAC, back come
// timed segments. GET /transcribe/health says whether it is set up.

export interface TranscribeTarget {
  baseUrl: string;
  token: string | null;
  timeoutMs: number;
  fetch?: typeof fetch;
}

function address(target: TranscribeTarget, path: string): string {
  const url = checkLocalUrl(target.baseUrl);
  if (!url.ok) throw new Error(`The transcription address is not allowed: ${url.reason}`);
  return `${url.base}${path}`;
}

const auth = (target: TranscribeTarget): Record<string, string> => (target.token ? { authorization: `Bearer ${target.token}` } : {});

// The model it runs, or why it cannot transcribe.
export async function transcriberHealth(target: TranscribeTarget): Promise<{ ok: true; model: string } | { ok: false; problem: string }> {
  let response: Response;
  try {
    response = await (target.fetch ?? fetch)(address(target, "/transcribe/health"), { headers: auth(target), redirect: "error", signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    return { ok: false, problem: error instanceof Error && error.message.startsWith("The transcription address") ? error.message : `The renderer is not answering at ${target.baseUrl}, so videos are not transcribed.` };
  }
  const body = (await response.json().catch(() => ({}))) as { ok?: unknown; model?: unknown; error?: unknown };
  if (response.status === 401 || response.status === 403) return { ok: false, problem: "The renderer refused the token (TROUPE_TRANSCRIBE_TOKEN)." };
  if (response.status === 404) return { ok: false, problem: `The renderer at ${target.baseUrl} has no transcription; update it.` };
  if (!response.ok || body.ok !== true) return { ok: false, problem: typeof body.error === "string" ? body.error : `The renderer cannot transcribe (${response.status}).` };
  return { ok: true, model: typeof body.model === "string" ? body.model : "whisper" };
}

export function rendererTranscriber(target: TranscribeTarget, model: string): Transcriber {
  return {
    model,
    async transcribe(audio, options) {
      if (audio.kind !== "file") throw new Error("The self-hosted transcriber takes a file.");
      const timeout = AbortSignal.timeout(target.timeoutMs);
      const response = await (target.fetch ?? fetch)(address(target, "/transcribe"), {
        method: "POST",
        headers: { ...auth(target), "content-type": "audio/flac" },
        body: new Uint8Array(await readFile(audio.path)),
        redirect: "error",
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      });
      const body = (await response.json().catch(() => ({}))) as { language?: unknown; model?: unknown; segments?: unknown; error?: unknown };
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `the renderer answered ${response.status}`);
      const segments = Array.isArray(body.segments) ? body.segments : [];
      const out: Transcript = {
        language: typeof body.language === "string" ? body.language : null,
        model: typeof body.model === "string" ? body.model : model,
        segments: segments
          .map((s: { start?: unknown; end?: unknown; text?: unknown }) => ({ startS: Number(s.start), endS: Number(s.end), text: typeof s.text === "string" ? s.text.trim() : "" }))
          .filter((s) => Number.isFinite(s.startS) && Number.isFinite(s.endS) && s.text),
      };
      return out;
    },
  };
}
