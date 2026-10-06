"use client";

import { useState } from "react";

interface Tool {
  name: string;
  label: string;
  ready: boolean;
  model: string | null;
  detail: string;
}

// What reads the library here, on one line: a filled dot for each tool that
// works, a ring for one that does not; the details open with the reasons.
export function ToolStatus({ tools }: { tools: Tool[] }) {
  const [open, setOpen] = useState(false);
  const missing = tools.filter((t) => !t.ready);
  return (
    <div className="text-xs">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="-mx-1 flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 rounded px-1 text-left text-muted transition-colors duration-150 hover:text-fg">
        {tools.map((t) => (
          <span key={t.name} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`size-2 rounded-full ${t.ready ? "bg-success" : "border border-warning"}`} />
            <span>{t.label}</span>
            <span className="sr-only">{t.ready ? " (ready)," : " (not ready),"}</span>
          </span>
        ))}
        <span className="text-primary">{open ? "Hide details" : missing.length ? `${missing.length} not ready · details` : "Details"}</span>
      </button>
      {open ? (
        <dl className="mt-2 grid max-w-3xl gap-x-6 gap-y-2 border-t border-muted/15 pt-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          {tools.map((t) => (
            <div key={t.name} className="contents">
              <dt className="flex items-center gap-1.5 font-medium text-fg">
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${t.ready ? "bg-success" : "border border-warning"}`} />
                {t.label}
                <span className="sr-only">{t.ready ? "(ready)" : "(not ready)"}</span>
              </dt>
              <dd className="text-pretty text-muted max-sm:mb-1 max-sm:pl-3.5">
                {t.model ? <span className="mr-1.5 font-mono text-fg">{t.model}</span> : null}
                {t.detail}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
