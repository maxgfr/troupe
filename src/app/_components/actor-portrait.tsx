// Self-hosted actor portrait — deterministic hue from the actor id, initials
// centered. No external avatar host: the versioned portrait sets
// (actors/<slug>/v1/*) plug in here once the storage adapter serves them.
export function ActorPortrait({
  id,
  name,
  label,
  className,
}: {
  id: string;
  name: string;
  label: string;
  className?: string;
}) {
  const hue = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const initials = name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label={label} className={className} preserveAspectRatio="xMidYMid slice">
      <rect width="100" height="100" fill={`oklch(0.3 0.05 ${hue})`} />
      <text
        x="50"
        y="50"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize="30"
        fontFamily="var(--font-geist-sans), system-ui, sans-serif"
        fill={`oklch(0.92 0.02 ${hue})`}
      >
        {initials}
      </text>
    </svg>
  );
}
