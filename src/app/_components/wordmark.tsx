import Link from "next/link";

// « troupe » in Bricolage Grotesque, lowercase — the "o" wears the gold
// spotlight ring, the brand's single allowed flourish. Drawn like the landing
// page's (site/src/landing/landing.css .wordmark): a line height of 1, so the
// ring hugs the letter instead of the line box.
export function Wordmark({ href = "/", className = "text-[1.375rem]" }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center rounded-md font-display leading-none font-bold tracking-[-0.03em] text-fg lowercase ${className}`}
      aria-label="troupe — home"
    >
      <span aria-hidden className="inline-flex items-baseline">
        tr
        <span className="relative inline-block">
          o
          <span className="absolute -inset-x-[0.08em] -inset-y-[0.02em] rounded-full border-[0.06em] border-spot" />
        </span>
        upe
      </span>
    </Link>
  );
}
