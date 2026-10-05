// What a command's failure looks like: a message for people, a stable code
// for scripts, and the exit status (documented in docs/CLI.md).

export const EXIT = {
  ok: 0,
  // The studio refused or a render failed.
  failed: 1,
  // Wrong command, option or value.
  usage: 2,
  // Not signed in, or the access code is wrong.
  auth: 3,
  // The studio cannot be reached.
  unreachable: 4,
  // `render watch` stopped waiting; the render goes on in the studio.
  timeout: 5,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export class CliError extends Error {
  readonly exitCode: ExitCode;
  readonly code: string;

  constructor(message: string, opts: { exitCode?: ExitCode; code?: string } = {}) {
    super(message);
    this.name = "CliError";
    this.exitCode = opts.exitCode ?? EXIT.failed;
    this.code = opts.code ?? "FAILED";
  }
}

export function usageError(message: string): CliError {
  return new CliError(message, { exitCode: EXIT.usage, code: "USAGE" });
}
