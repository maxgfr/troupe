const EMOTIONS = ["neutral", "excited", "calm", "serious", "happy", "disappointed"] as const;

export interface ScriptLineView {
  index: number;
  role: string;
  text: string;
  emotion: string | null;
}

// Pure view — one script version as chat bubbles; the emotion chips are the
// per-line performance directions.
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
        <li key={line.index} className="rounded-xl bg-surface px-4 py-3">
          <p className="flex items-baseline gap-2">
            <span className="font-mono text-xs uppercase text-muted">{line.role}</span>
            <span className="text-sm">{line.text}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`Emotion for line ${line.index + 1}`}>
            {EMOTIONS.map((emotion) => (
              <button
                type="button"
                key={emotion}
                onClick={() => onEmotion?.(line.index, emotion)}
                disabled={!onEmotion}
                aria-pressed={line.emotion === emotion}
                className={`rounded-md px-2 py-0.5 text-xs transition-colors duration-150 ${
                  line.emotion === emotion
                    ? "bg-primary/20 font-medium text-primary"
                    : "text-muted hover:text-fg"
                }`}
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

