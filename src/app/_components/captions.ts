// In-app render previews caption themselves from the generation's
// OWN script — a real track from real content, never an empty placeholder.
// One cue per script line, boundaries prorated by word count
// over the clip; a single line degrades to the spanning-cue baseline. The
// exported file gets platform captions at export time.

// compilePrompt's deterministic shape: directives, then "Dialogue:" followed
// by one "[emotion] (role) text" line per spoken line.
export function spokenLinesFromPrompt(prompt: string): string[] | null {
  const marker = prompt.indexOf("Dialogue:");
  if (marker === -1) return null;
  const lines = prompt
    .slice(marker + "Dialogue:".length)
    .split("\n")
    .map((l) => l.replace(/^\[[^\]]*\]\s*\([^)]*\)\s*/, "").trim())
    .filter(Boolean);
  return lines.length ? lines : null;
}

export function spokenTextFromPrompt(prompt: string): string | null {
  return spokenLinesFromPrompt(prompt)?.join("\n") ?? null;
}

function stamp(totalS: number): string {
  const ms = Math.round(totalS * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor((ms % 3_600_000) / 60_000))}:${pad(
    Math.floor((ms % 60_000) / 1000),
  )}.${pad(ms % 1000, 3)}`;
}

export function vttFromLines(lines: string[], durationS: number): string {
  const spoken = lines.map((l) => l.trim()).filter(Boolean);
  const end = Math.max(1, Math.floor(durationS) || 0);
  const words = spoken.map((l) => l.split(/\s+/).length);
  const total = words.reduce((a, b) => a + b, 0) || 1;
  let from = 0;
  let seen = 0;
  const cues = spoken.map((line, i) => {
    seen += words[i]!;
    const to = i === spoken.length - 1 ? end : (end * seen) / total;
    const cue = `${stamp(from)} --> ${stamp(to)}\n${line}`;
    from = to;
    return cue;
  });
  const vtt = `WEBVTT\n\n${cues.join("\n\n")}\n`;
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(vtt)}`;
}

export function vttFromText(text: string, durationS: number): string {
  return vttFromLines([text], durationS);
}
