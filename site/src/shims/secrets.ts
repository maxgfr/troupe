import type * as Real from "~/server/settings/secrets";

// Stands in for src/server/settings/secrets.ts in the browser edition. Saved
// secrets are sealed with a key that lives on the server; the browser edition
// has no server, so it never stores one. Callers already turn
// SecretUnavailableError into "enter it again" or a PRECONDITION_FAILED with
// this message.

const NEEDS_SELF_HOSTED = "API keys and tokens are saved by the self-hosted studio only, on your own server.";

export class SecretUnavailableError extends Error {
  constructor(message = "This saved secret can no longer be decrypted. Enter it again.") {
    super(message);
    this.name = "SecretUnavailableError";
  }
}

export type SecretBox = Real.SecretBox;

export function createSecretBox(): SecretBox {
  throw new SecretUnavailableError(NEEDS_SELF_HOSTED);
}

export function loadSecretBox(): SecretBox {
  throw new SecretUnavailableError(NEEDS_SELF_HOSTED);
}

export function resetSecretBoxCache() {}

// Fails the typecheck when the real module's exports change shape.
({ SecretUnavailableError, createSecretBox, loadSecretBox, resetSecretBoxCache }) satisfies typeof Real;
