import { beforeEach, describe, expect, it, vi } from "vitest";

// WebLLM itself needs WebGPU: here a stand-in engine whose loading and
// answers the tests hold or release, to check that a request ends when its
// signal does, whatever WebLLM is waiting for.
const engine = vi.hoisted(() => ({
  load: null as null | (() => Promise<unknown>),
}));
vi.mock("@mlc-ai/web-llm", () => ({ CreateWebWorkerMLCEngine: () => engine.load!() }));
vi.stubGlobal(
  "Worker",
  class {
    terminate() {}
  },
);

const schema = { type: "object", properties: {}, required: [] } as never;
const turns = [{ role: "user" as const, content: "Write it." }];

function answerable() {
  const pending: { release: (text: string) => void }[] = [];
  const started: string[] = [];
  const loaded = {
    interruptGenerate: () => {},
    chat: {
      completions: {
        create: ({ messages }: { messages: { content: string }[] }) =>
          new Promise((resolve) => {
            started.push(messages[0]!.content);
            pending.push({ release: (text) => resolve({ choices: [{ message: { content: text } }] }) });
          }),
      },
    },
  };
  return { loaded, pending, started };
}

beforeEach(() => {
  vi.resetModules();
});

describe("the in-browser chat model", () => {
  it("gives up when its time runs out while the model is still loading", async () => {
    engine.load = () => new Promise(() => {});
    const { webllmChat } = await import("./webllm");
    const started = Date.now();
    await expect(webllmChat("tiny").propose(turns, { schema, signal: AbortSignal.timeout(50) })).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("gives up while waiting its turn, and the next request still waits for the one running", async () => {
    const { loaded, pending, started } = answerable();
    engine.load = async () => loaded;
    const { webllmChat } = await import("./webllm");
    const chat = webllmChat("tiny");
    const first = chat.propose([{ role: "user", content: "first" }], { schema });
    await vi.waitFor(() => expect(started).toEqual(["first"]));
    const stop = new AbortController();
    const waiting = chat.propose([{ role: "user", content: "waiting" }], { schema, signal: stop.signal });
    stop.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    const third = chat.propose([{ role: "user", content: "third" }], { schema });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The one stopped while waiting never ran; the third waits for the first.
    expect(started).toEqual(["first"]);
    pending[0]!.release('{"a": 1}');
    await expect(first).resolves.toMatchObject({ proposal: { a: 1 } });
    await vi.waitFor(() => expect(started).toEqual(["first", "third"]));
    pending[1]!.release('{"b": 2}');
    await expect(third).resolves.toMatchObject({ proposal: { b: 2 } });
  });

  it("does not hand back an answer cut off by its time limit", async () => {
    const { loaded, pending, started } = answerable();
    engine.load = async () => loaded;
    let interrupted = 0;
    loaded.interruptGenerate = () => {
      interrupted += 1;
      // WebLLM ends the answer it had, cut short.
      pending.at(-1)!.release('{"ideas": [');
    };
    const { webllmChat } = await import("./webllm");
    const stop = new AbortController();
    const asked = webllmChat("tiny").propose(turns, { schema, signal: stop.signal });
    await vi.waitFor(() => expect(started).toHaveLength(1));
    stop.abort();
    await expect(asked).rejects.toMatchObject({ name: "AbortError" });
    expect(interrupted).toBe(1);
  });
});
