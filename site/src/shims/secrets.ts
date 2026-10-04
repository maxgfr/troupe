import type * as Real from "~/server/settings/secrets";

// Stands in for src/server/settings/secrets.ts in the browser demo. Saved
// secrets are sealed with a key that lives on the server; the demo has no
// server, so it never stores one. Callers already turn SecretUnavailableError
// into "enter it again" or a PRECONDITION_FAILED with this message.

const NOT_IN_DEMO = "API keys and tokens cannot be saved in the browser demo. Run Troupe yourself to use them.";

export class SecretUnavailableError extends Error {
  constructor(message = "This saved secret can no longer be decrypted. Enter it again.") {
    super(message);
    this.name = "SecretUnavailableError";
  }
}

export type SecretBox = Real.SecretBox;

export function createSecretBox(): SecretBox {
  throw new SecretUnavailableError(NOT_IN_DEMO);
}

export function loadSecretBox(): SecretBox {
  throw new SecretUnavailableError(NOT_IN_DEMO);
}

export function resetSecretBoxCache() {}

// Fails the typecheck when the real module's exports change shape.
({ SecretUnavailableError, createSecretBox, loadSecretBox, resetSecretBoxCache }) satisfies typeof Real;
