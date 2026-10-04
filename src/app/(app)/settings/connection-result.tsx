export interface Report {
  ok: boolean | null;
  message: string;
  details?: string[];
  pollEveryS?: number;
}

// The outcome of a "Test" click: green, red, or "can't tell without spending".
export function ConnectionResult({ report }: { report?: Report }) {
  if (!report) return null;
  const tone = report.ok === true ? "text-success" : report.ok === false ? "text-danger" : "text-muted";
  return (
    <div role="status" className={`text-xs ${tone}`}>
      <p>{report.ok === true ? "✓ " : report.ok === false ? "✗ " : ""}{report.message}</p>
      {report.details?.length ? (
        <ul className="mt-1 list-disc pl-5 text-muted">
          {report.details.map((d) => <li key={d}>{d}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
