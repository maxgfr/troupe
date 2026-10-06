import { describe, expect, it } from "vitest";

import { parseKokoroDtype } from "./kokoro";

describe("parseKokoroDtype", () => {
  it("reads KOKORO_DTYPE, q8 when unset or empty", () => {
    expect(parseKokoroDtype(undefined)).toBe("q8");
    expect(parseKokoroDtype("")).toBe("q8");
    expect(parseKokoroDtype(" fp32 ")).toBe("fp32");
    for (const dtype of ["fp16", "q4", "q4f16"]) expect(parseKokoroDtype(dtype)).toBe(dtype);
  });

  it("refuses anything else, naming the choices", () => {
    expect(() => parseKokoroDtype("int8")).toThrow(
      'KOKORO_DTYPE must be one of fp32, fp16, q8, q4, q4f16 (got "int8").',
    );
    expect(() => parseKokoroDtype("Q8")).toThrow(/KOKORO_DTYPE/);
  });
});
