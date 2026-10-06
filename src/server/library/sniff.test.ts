import { expect, it } from "vitest";

import { fileRefusal } from "./sniff";

// One answer for a file the library cannot save, in both editions: the
// studio's upload route and the browser edition's uploader ask the same.
it("says an empty file is empty, and names what the library reads otherwise", () => {
  expect(fileRefusal(0, new Uint8Array())).toBe("The file is empty.");
  expect(fileRefusal(4, new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toMatch(/^This file is not one the library reads/);
  expect(fileRefusal(5, new TextEncoder().encode("Hello"))).toBeNull();
});
