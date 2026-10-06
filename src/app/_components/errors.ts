// A route id that is not a UUID can never name a record, so pages treat it as
// a missing one instead of sending it to a query that rejects it.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID.test(value);

// Input validation failures (a zod error serialised into the message) are not
// something to show a person; any other message is already worded for them.
export function errorText(error: { message: string; data?: { code?: string; zodError?: unknown } | null }): string {
  const text = error.message.trim();
  if (error.data?.zodError || (error.data?.code === "BAD_REQUEST" && /^[[{]/.test(text))) {
    return "That request was not valid. Reload the page and try again.";
  }
  return error.message;
}
