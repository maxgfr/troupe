const STEPS = ["Platform", "Format", "Language", "Actor"] as const;

// The wizard's linear stepper — four load-bearing choices, nothing else: a
// segment per step that fills as you go, the step's name below it.
export function WizardStepper({ current }: { current: number }) {
  return (
    <ol className="mb-10 grid max-w-2xl grid-cols-4 gap-2" aria-label="Wizard steps">
      {STEPS.map((step, i) => (
        <li key={step} className="space-y-2">
          <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-fg/[0.1]">
            <span className={`block h-full rounded-full bg-primary transition-[width] duration-250 ease-out motion-reduce:transition-none ${i <= current ? "w-full" : "w-0"}`} />
          </span>
          <span
            aria-current={i === current ? "step" : undefined}
            className={`block text-sm transition-colors duration-150 ${i === current ? "font-medium text-fg" : i < current ? "text-fg/80" : "text-muted"}`}
          >
            <span className="font-mono text-xs tabular-nums text-muted">{i + 1}</span> {step}
          </span>
        </li>
      ))}
    </ol>
  );
}

