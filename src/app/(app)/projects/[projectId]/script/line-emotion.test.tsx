// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

type Options = {
  scope?: { id: string };
  onMutate: (input: { scriptId: string; lineIndex: number; emotion: string }) => Promise<{ previous: unknown }>;
  onError: (error: Error, input: unknown, context?: { previous: unknown }) => void;
  onSettled: () => void;
};
let options: Options;
let data: unknown;
const utils = {
  script: {
    history: {
      cancel: vi.fn(async () => {}),
      getData: vi.fn(() => data),
      setData: vi.fn((_input: unknown, next: unknown) => {
        data = typeof next === "function" ? (next as (old: unknown) => unknown)(data) : next;
      }),
      invalidate: vi.fn(async () => {}),
    },
  },
};
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => utils,
    script: {
      setLineEmotion: {
        useMutation: (o: Options) => {
          options = o;
          return { mutate: vi.fn() };
        },
      },
    },
  },
}));

import { useLineEmotion } from "./line-emotion";

const version = (emotion: string) => [{ id: "s1", lines: [{ index: 0, text: "Hook.", role: "hook", emotion }] }];

describe("a line's emotion", () => {
  it("shows at once, and goes back to the saved one when saving fails", async () => {
    data = version("neutral");
    renderHook(() => useLineEmotion("p1"));
    const context = await options.onMutate({ scriptId: "s1", lineIndex: 0, emotion: "calm" });
    expect(data).toEqual(version("calm"));
    options.onError(new Error("offline"), {}, context);
    expect(data).toEqual(version("neutral"));
  });

  it("saves one choice at a time, in order, and reads the saved script back once the last has landed", async () => {
    data = version("neutral");
    utils.script.history.invalidate.mockClear();
    renderHook(() => useLineEmotion("p1"));
    expect(options.scope).toEqual({ id: "line-emotion-p1" });
    await options.onMutate({ scriptId: "s1", lineIndex: 0, emotion: "calm" });
    await options.onMutate({ scriptId: "s1", lineIndex: 0, emotion: "happy" });
    expect(data).toEqual(version("happy"));
    options.onSettled();
    expect(utils.script.history.invalidate).not.toHaveBeenCalled();
    options.onSettled();
    expect(utils.script.history.invalidate).toHaveBeenCalledTimes(1);
  });
});
