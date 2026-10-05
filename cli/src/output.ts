// Human output: aligned tables and short ids. --json prints the data as the
// API returned it instead (dates as ISO strings).

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "-";
}

// Columns padded to their widest cell; the last column is never padded so
// long text (a line of script, an error) wraps naturally.
export function table(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cells = [headers, ...rows.map((row) => row.map((cell) => (cell === null || cell === undefined || cell === "" ? "-" : String(cell))))];
  const widths = headers.map((_, col) => Math.max(...cells.map((row) => (row[col] ?? "").length)));
  return cells
    .map((row) => row.map((cell, col) => (col === row.length - 1 ? cell : cell.padEnd(widths[col] ?? 0))).join("  ").trimEnd())
    .join("\n");
}

// "key: value" lines, keys aligned.
export function fields(entries: [string, string | number | boolean | null | undefined][]): string {
  const width = Math.max(...entries.map(([key]) => key.length));
  return entries.map(([key, value]) => `${`${key}:`.padEnd(width + 1)} ${value === null || value === undefined || value === "" ? "-" : String(value)}`).join("\n");
}

export function when(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const at = new Date(date);
  if (Number.isNaN(at.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function ago(date: Date | string | null | undefined, now = Date.now()): string {
  if (!date) return "never";
  const s = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// [3, 4, 5, 6, 8, 10] → "3-6, 8, 10".
export function numberRanges(values: readonly number[]): string {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!;
    while (sorted[i + 1] === sorted[i]! + 1) i++;
    runs.push(sorted[i] === start ? String(start) : sorted[i] === start + 1 ? `${start}, ${sorted[i]}` : `${start}-${sorted[i]}`);
  }
  return runs.join(", ");
}

// A sentence from the studio, ended once.
export function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
