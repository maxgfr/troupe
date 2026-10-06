// The presentation video's chapters (site/public/tour/troupe-tour-chapters.vtt,
// written by scripts/tour/edit.sh): one WebVTT cue per step, its identifier
// naming the step.

export interface Chapter {
  id: string;
  start: number;
  title: string;
}

const TIMING = /^((?:\d+:)?\d{2}:\d{2}\.\d{3}) --> /;

// WebVTT cue text escapes &, < and > (and may use a few named references).
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", nbsp: "\u00a0", lrm: "\u200e", rlm: "\u200f" };
const decode = (text: string) => text.replace(/&(amp|lt|gt|nbsp|lrm|rlm);/g, (_, name: string) => ENTITIES[name]!);

function seconds(stamp: string): number {
  return stamp.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

export function parseChapters(vtt: string): Chapter[] {
  const text = vtt.replace(/\r\n?/g, "\n");
  if (!text.startsWith("WEBVTT")) return [];
  return text
    .split(/\n{2,}/)
    .slice(1)
    .flatMap((block) => {
      const lines = block.trim().split("\n");
      const at = lines.findIndex((line) => TIMING.test(line));
      if (at < 1) return [];
      return [
        {
          id: lines[at - 1]!,
          start: seconds(TIMING.exec(lines[at]!)![1]!),
          title: decode(lines.slice(at + 1).join(" ")),
        },
      ];
    });
}

// 65.5 → "1:05", as video players show times.
export function clock(time: number): string {
  const whole = Math.floor(time);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
