import { CheckIcon, CloseIcon } from "~/app/_components/icons";

export interface Report {
  ok: boolean | null;
  message: string;
  details?: string[];
  pollEveryS?: number;
}

// Drawn at the text's size, in its color.
function Mark({ ok }: { ok: boolean }) {
  return ok ? <CheckIcon className="mt-px size-3.5" /> : <CloseIcon className="mt-px size-3.5" />;
}

// The outcome of a "Test" click: green, red, or "can't tell without spending".
export function ConnectionResult({ report }: { report?: Report }) {
  if (!report) return null;
  const tone = report.ok === true ? "text-success" : report.ok === false ? "text-danger" : "text-muted";
  return (
    <div role="status" className={`text-xs ${tone}`}>
      <p className="flex gap-1.5">{report.ok === null ? null : <Mark ok={report.ok} />}<span>{report.message}</span></p>
      {report.details?.length ? (
        <ul className="mt-1 list-disc pl-5 text-muted">
          {report.details.map((d) => <li key={d}>{d}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
