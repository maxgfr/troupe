import Link from "next/link";

// « troupe » in Bricolage Grotesque, lowercase — the "o" wears the gold
// spotlight ring, the brand's single allowed flourish.
export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="font-display text-xl font-bold lowercase tracking-tight text-fg"
      aria-label="troupe — home"
    >
      tr
      <span className="relative inline-block">
        o
        <span
          aria-hidden
          className="absolute -inset-x-[0.08em] -inset-y-[0.02em] rounded-full border-2 border-spot"
        />
      </span>
      upe
    </Link>
  );
}
