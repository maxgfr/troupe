import Link from "next/link";

// Shared « régie » primitives. Every screen speaks this vocabulary; cobalt
// (primary) marks interaction, gold (spot) marks "a human decision is
// awaited", semantic colors mark job/data states — never mood.

export function PageHeader({
  title,
  lede,
  actions,
}: {
  title: string;
  lede?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {lede ? <p className="mt-1 max-w-[72ch] text-sm text-muted">{lede}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-10 ${className}`}>
      {title ? <h2 className="mb-3 text-base font-semibold">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-surface ${className}`} />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

// Empty states teach the first useful action (design principle).
export function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { label: string; href: string };
}) {
  return (
    <div className="rounded-xl border border-muted/25 px-8 py-12 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-[52ch] text-sm text-muted">{body}</p>
      {cta ? (
        <Link
          href={cta.href}
          className="mt-5 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity duration-150 hover:opacity-90"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}

const JOB_TONES: Record<string, string> = {
  queued: "bg-surface text-muted",
  running: "bg-primary/15 text-primary",
  in_progress: "bg-primary/15 text-primary",
  completed: "bg-success/15 text-success",
  done: "bg-success/15 text-success",
  succeeded: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
  draft: "bg-surface text-muted",
  final: "bg-success/15 text-success",
  approved: "bg-success/15 text-success",
  pending: "bg-spot/20 text-fg",
  rejected: "bg-danger/15 text-danger",
};

export function StatusChip({ status }: { status: string }) {
  const tone = JOB_TONES[status] ?? "bg-surface text-muted";
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${tone}`}>
      {status}
    </span>
  );
}

// Gold = a human decision is awaited. The ONLY component allowed to wear it.
export function SpotButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`rounded-lg bg-spot px-4 py-2 text-sm font-semibold text-on-spot transition-opacity duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 ${rest.className ?? ""}`}
    >
      {children}
    </button>
  );
}

// Provider constraints explain themselves BEFORE the API call (principle 3).
export function ProviderWarning({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
    >
      {children}
    </p>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
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
