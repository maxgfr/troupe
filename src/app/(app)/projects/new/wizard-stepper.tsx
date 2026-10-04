const STEPS = ["Platform", "Format", "Language", "Actor"] as const;

// The wizard's linear stepper — four load-bearing choices, nothing else.
export function WizardStepper({ current }: { current: number }) {
  return (
    <ol className="mb-8 grid grid-cols-2 gap-2 sm:flex sm:items-center" aria-label="Wizard steps">
      {STEPS.map((step, i) => (
        <li key={step} className="flex items-center gap-2">
          <span
            aria-current={i === current ? "step" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors duration-150 ${
              i === current
                ? "bg-primary font-medium text-on-primary"
                : i < current
                  ? "text-primary"
                  : "text-muted"
            }`}
          >
            {i + 1}. {step}
          </span>
          {i < STEPS.length - 1 ? <span className="hidden text-muted/50 sm:inline">→</span> : null}
        </li>
      ))}
    </ol>
  );
}

