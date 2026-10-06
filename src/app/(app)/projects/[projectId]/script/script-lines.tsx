const EMOTIONS = ["neutral", "excited", "calm", "serious", "happy", "disappointed"] as const;

export interface ScriptLineView {
  index: number;
  role: string;
  text: string;
  emotion: string | null;
}

import { chipClass } from "~/app/_components/ui";

// Pure view — one script version as cue cards: the line's role in small mono
// caps, the line itself at reading size, and its emotion as chips (the
// per-line performance direction).
export function ScriptLines({
  lines,
  onEmotion,
}: {
  lines: ScriptLineView[];
  onEmotion?: (lineIndex: number, emotion: (typeof EMOTIONS)[number]) => void;
}) {
  return (
    <ol className="space-y-3">
      {lines.map((line) => (
        <li key={line.index} className="rounded-2xl bg-surface px-4 py-4 sm:px-5">
          <p className="font-mono text-[11px] tracking-wide text-muted uppercase">
            {line.role === "cta" ? "call to action" : line.role}
          </p>
          <p className="mt-1 text-pretty text-base leading-snug">{line.text}</p>
          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={`Emotion for line ${line.index + 1}`}>
            {EMOTIONS.map((emotion) => (
              <button
                type="button"
                key={emotion}
                onClick={() => onEmotion?.(line.index, emotion)}
                disabled={!onEmotion}
                aria-pressed={line.emotion === emotion}
                className={chipClass(line.emotion === emotion, "disabled:cursor-default pointer-coarse:min-h-10", "sm")}
              >
                {emotion}
              </button>
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}
