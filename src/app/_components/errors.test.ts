import { expect, it } from "vitest";

import { errorText, isUuid } from "./errors";

it("recognises UUIDs and nothing else", () => {
  expect(isUuid("3f2b8a52-7c1e-4d0a-9b53-0a1f6c2d8e47")).toBe(true);
  expect(isUuid("does-not-exist")).toBe(false);
  expect(isUuid("")).toBe(false);
});

it("never shows a serialised validation error", () => {
  const raw = '[ { "validation": "uuid", "code": "invalid_string", "path": [ "projectId" ] } ]';
  expect(errorText({ message: raw, data: { code: "BAD_REQUEST" } })).toBe(
    "That request was not valid. Reload the page and try again.",
  );
  expect(errorText({ message: raw, data: { zodError: {} } })).not.toContain("validation");
  expect(errorText({ message: "Database unavailable", data: { code: "INTERNAL_SERVER_ERROR" } })).toBe(
    "Database unavailable",
  );
  expect(errorText({ message: "Plain failure" })).toBe("Plain failure");
});
