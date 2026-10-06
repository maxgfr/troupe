import Link from "next/link";

// Shared « régie » primitives. Every screen speaks this vocabulary
// (docs/PRODUCT-MAP.md); cobalt (primary) marks interaction, gold (spot)
// marks "a human decision is awaited", semantic colors mark job/data states,
// never mood.

// --- Controls -------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "outline" | "quiet" | "danger" | "danger-solid";
export type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg whitespace-nowrap select-none transition-[background-color,box-shadow,color,opacity,scale] duration-150 ease-out active:scale-[0.96] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";

const BUTTON_SIZES: Record<ButtonSize, string> = {
  // Dense rows; still 36 px tall, 40 on touch screens.
  sm: "min-h-9 px-3 text-sm pointer-coarse:min-h-10",
  md: "min-h-10 px-4 text-sm",
  lg: "min-h-12 px-6 text-base",
};

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // The one cobalt action of a view, with the landing's soft cobalt glow.
  primary:
    "bg-primary font-semibold text-on-primary shadow-[0_1px_2px_rgb(0_0_0/0.2),0_6px_18px_color-mix(in_srgb,var(--troupe-color-primary)_22%,transparent)] hover:bg-[color-mix(in_oklch,var(--troupe-color-primary)_88%,var(--troupe-color-foreground))]",
  secondary: "font-medium text-fg shadow-[inset_0_0_0_1px_var(--troupe-color-line-strong)] hover:bg-fg/[0.06]",
  // A cobalt action that is not the view's main one (ten idea cards must not
  // make ten primary buttons).
  outline: "font-medium text-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--troupe-color-primary)_50%,transparent)] hover:bg-primary/10",
  quiet: "font-medium text-muted hover:bg-fg/[0.06] hover:text-fg",
  danger: "font-medium text-danger shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--troupe-color-danger)_50%,transparent)] hover:bg-danger/10",
  "danger-solid": "bg-danger font-semibold text-on-primary hover:bg-danger/90",
};

export function buttonClass({ variant = "secondary", size = "md", className = "" }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return `${BUTTON_BASE} ${BUTTON_SIZES[size]} ${BUTTON_VARIANTS[variant]} ${className}`;
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} {...rest} className={buttonClass({ variant, size, className })} />;
}

export function ButtonLink({
  href,
  variant,
  size,
  className,
  children,
  ...rest
}: Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string; variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <Link href={href} {...rest} className={buttonClass({ variant, size, className })}>
      {children}
    </Link>
  );
}

// A single choice among a few (platform, language, emotion, filters): a pill,
// cobalt-tinted when chosen. Put it on a <label> around an sr-only radio, or
// on a <button aria-pressed>.
export function chipClass(selected: boolean, className = ""): string {
  return `inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3.5 text-sm transition-[background-color,box-shadow,color] duration-150 ease-out has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40 ${
    selected
      ? "bg-primary/15 font-medium text-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--troupe-color-primary)_45%,transparent)]"
      : "text-muted shadow-[inset_0_0_0_1px_var(--troupe-color-line)] hover:bg-fg/[0.06] hover:text-fg"
  } ${className}`;
}

// Inputs, selects and text areas. A select carrying it also gets
// data-field, so the global focus outline leaves it to this ring.
export const fieldClass =
  "w-full rounded-lg bg-surface px-3 py-2 text-sm text-fg shadow-[inset_0_0_0_1px_var(--troupe-color-line)] outline-none transition-[box-shadow,background-color] duration-150 ease-out placeholder:text-muted/80 hover:shadow-[inset_0_0_0_1px_var(--troupe-color-line-strong)] focus:shadow-[inset_0_0_0_2px_var(--troupe-color-focus)] disabled:opacity-50 aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--troupe-color-warning)]";

// A raised panel: one elevation (shadow in light, tint in dark), no border.
export const panelClass = "rounded-2xl bg-raised shadow-card";

// A key, as the shortcuts list and hints show it.
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded-md bg-surface px-1.5 py-0.5 font-mono text-xs text-fg shadow-[inset_0_-1px_0_var(--troupe-color-line-strong),inset_0_0_0_1px_var(--troupe-color-line)]">
      {children}
    </kbd>
  );
}

// --- Page structure ---------------------------------------------------------

export function PageHeader({
  title,
  lede,
  actions,
  media,
}: {
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  // A picture before the title (a project's actor).
  media?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="flex min-w-0 items-center gap-4">
        {media}
        <div className="min-w-0">
          <h1 className="font-display text-[1.75rem] leading-[1.1] font-semibold tracking-[-0.02em] sm:text-[2rem]">{title}</h1>
          {lede ? <div className="mt-2 max-w-[65ch] text-pretty text-sm text-muted sm:text-[0.9375rem]">{lede}</div> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({
  title,
  children,
  className = "",
  id,
  action,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  id?: string;
  action?: React.ReactNode;
}) {
  return (
    <section id={id} className={`mb-12 scroll-mt-24 ${className}`}>
      {title ? (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-[-0.01em]">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-fg/[0.06] motion-reduce:animate-none ${className}`} />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

// Empty states teach the first useful action (design principle).
export function EmptyState({
  title,
  body,
  cta,
  art,
  children,
}: {
  title: string;
  body: React.ReactNode;
  cta?: { label: string; href: string };
  // A picture above the title: the cast, a poster.
  art?: React.ReactNode;
  // Anything after the body (steps, a second action).
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-surface/70 px-6 py-12 text-center sm:px-10">
      {art ? <div className="mb-6 flex justify-center">{art}</div> : null}
      <p className="font-display text-xl font-semibold tracking-[-0.01em] sm:text-2xl">{title}</p>
      <div className="mx-auto mt-2 max-w-[52ch] text-pretty text-sm text-muted">{body}</div>
      {children}
      {cta ? (
        <ButtonLink href={cta.href} variant="primary" className="mt-6">
          {cta.label}
        </ButtonLink>
      ) : null}
    </div>
  );
}

// --- States -----------------------------------------------------------------

const JOB_TONES: Record<string, string> = {
  queued: "bg-fg/[0.07] text-muted",
  running: "bg-primary/15 text-primary",
  in_progress: "bg-primary/15 text-primary",
  completed: "bg-success/15 text-success",
  done: "bg-success/15 text-success",
  succeeded: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
  draft: "bg-fg/[0.07] text-muted",
  final: "bg-success/15 text-success",
  approved: "bg-success/15 text-success",
  pending: "bg-spot/20 text-fg",
  rejected: "bg-danger/15 text-danger",
};

// Job states in words: the stored `in_progress` reads as "rendering".
const JOB_LABELS: Record<string, string> = { in_progress: "rendering" };

// A status in a pill. `chipBase` is shared with the stage and item chips.
export const statusChipBase = "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium";

export function StatusChip({ status }: { status: string }) {
  const tone = JOB_TONES[status] ?? "bg-fg/[0.07] text-muted";
  const live = status === "in_progress" || status === "running";
  return (
    <span className={`${statusChipBase} ${tone}`}>
      {live ? <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" /> : null}
      {JOB_LABELS[status] ?? status}
    </span>
  );
}

// A render's progress: what it is doing, a figure, and the cobalt bar (the
// only theatrical motion). `fraction` null means the share is unknown: the
// bar then glows half full. Sits in the timeline's live region, so the
// figures stay out of it; the progressbar carries them instead.
export function ProgressBar({ label, figure, fraction }: { label: string; figure?: string | null; fraction: number | null }) {
  const percent = fraction === null ? null : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <div className="w-full space-y-1.5 sm:w-72">
      <p aria-hidden className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-fg">{label}</span>
        {figure ? <span className="font-mono tabular-nums text-muted">{figure}</span> : null}
      </p>
      <div
        role="progressbar"
        aria-label="Render progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={figure ? `${label}, ${figure}` : label}
        className="progress-glow h-1.5 overflow-hidden rounded-full bg-primary/20"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out motion-reduce:transition-none"
          style={{ width: percent === null ? "50%" : `${Math.max(percent, 2)}%` }}
        />
      </div>
    </div>
  );
}

// Gold = a human decision is awaited. The ONLY component allowed to wear it.
export function SpotButton({
  children,
  className = "",
  type = "button",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      {...rest}
      className={`${BUTTON_BASE} ${BUTTON_SIZES.md} bg-spot font-semibold text-on-spot hover:bg-[color-mix(in_oklch,var(--troupe-color-secondary)_88%,var(--troupe-color-foreground))] ${className}`}
    >
      {children}
    </button>
  );
}

// Provider constraints explain themselves BEFORE the API call (principle 3).
export function ProviderWarning({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="rounded-xl bg-warning/10 px-4 py-3 text-sm text-pretty shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--troupe-color-warning)_35%,transparent)]">
      {children}
    </p>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-pretty shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--troupe-color-danger)_40%,transparent)]">
      {children}
    </p>
  );
}

// Honest gate for the no-keys dev environment: protected data needs a session.
export function SignedOutNotice() {
  return (
    <EmptyState
      title="The studio could not be opened"
      body="Enter your private access code to reopen your studio."
      cta={{ label: "Enter access code", href: "/access" }}
    />
  );
}
