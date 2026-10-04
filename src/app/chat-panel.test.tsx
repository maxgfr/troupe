// @vitest-environment jsdom
// The project page's script chat: proposals read against the current version,
// applied or relaunched from the message, and failures said plainly.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ModelOptionView } from "./(app)/projects/model-choice";
import type { ScriptVersion } from "./(app)/projects/[projectId]/chat-panel";

type Message = Record<string, unknown>;
let messages: Message[] = [];
let provider: Record<string, unknown> | null = null;
const send = vi.fn();
const apply = vi.fn();
const applyAndLaunch = vi.fn();

vi.mock("next/navigation", () => ({ usePathname: () => "/projects/p1", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    chat: {
      history: { useQuery: () => ({ isPending: false, error: null, data: { messages, provider } }) },
      send: { useMutation: () => ({ mutate: send, isPending: false }) },
      applyProposal: { useMutation: () => ({ mutate: apply, isPending: false }) },
      applyAndLaunch: { useMutation: () => ({ mutate: applyAndLaunch, isPending: false }) },
    },
    actors: { list: { useQuery: () => ({ data: [{ id: "a1", name: "Aiko" }, { id: "a2", name: "Marcus" }] }) } },
  },
}));

import { ChatPanel } from "./(app)/projects/[projectId]/chat-panel";

const model: ModelOptionView = {
  key: "renderer", label: "Renderer", vendor: "local", kind: "local",
  capabilities: { aspectRatios: ["9:16"], resolutions: ["720p"], durationsS: [6, 8, 10], audio: "always", dialogueLanguages: ["en"] },
  defaults: { resolution: "720p", durationS: 8, audio: true },
  pricePerSecondUsd: null, available: true, unavailableReason: null, compatible: true, warnings: [],
};

const v1: ScriptVersion = { id: "s1", version: 1, estimatedDurationS: 3, lines: [
  { role: "hook", text: "Stop scrolling.", emotion: "neutral" },
  { role: "cta", text: "Buy now.", emotion: "neutral" },
] };
const v2: ScriptVersion = { ...v1, id: "s2", version: 2 };

const proposal = {
  summary: "A sharper hook.",
  lines: [
    { role: "hook", text: "Your mornings, fixed in ten seconds.", emotion: "excited" },
    { role: "cta", text: "Buy now.", emotion: "serious" },
  ],
};

function renderPanel(versions: ScriptVersion[] = [v1], base: { model: ModelOptionView; choice: { durationS?: number } } | null = { model, choice: { durationS: 8 } }) {
  render(<ChatPanel projectId="p1" versions={versions} base={base} currentActorId="a1" />);
}

beforeEach(() => {
  provider = { id: "ollama", label: "Ollama", modelId: "qwen3:4b", problem: null, wordsPerSecond: 2.5 };
  messages = [];
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("script chat", () => {
  it("teaches the first request and sends it with the clip it writes for", () => {
    renderPanel();
    expect(screen.getByText(/Ollama · qwen3:4b · 20 words for 8 s/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Make the hook punchier" }));
    expect(send).toHaveBeenCalledWith({ projectId: "p1", message: "Make the hook punchier", durationS: 8 });

    fireEvent.change(screen.getByLabelText("Ask for a change"), { target: { value: "Calmer please" } });
    fireEvent.keyDown(screen.getByLabelText("Ask for a change"), { key: "Enter" });
    expect(send).toHaveBeenLastCalledWith({ projectId: "p1", message: "Calmer please", durationS: 8 });
  });

  it("shows a proposal against the current version and relaunches it with the newest render's settings", () => {
    messages = [
      { id: "m1", role: "user", content: "Sharper hook", proposal: null, baseScriptId: "s1", appliedScriptId: null },
      { id: "m2", role: "assistant", content: proposal.summary, proposal, baseScriptId: "s1", appliedScriptId: null, provider: "ollama", model: "qwen3:4b" },
    ];
    renderPanel();
    const diff = screen.getByText("Your mornings, fixed in ten seconds.").closest("ol")!;
    // The hook is rewritten, the call to action retagged.
    expect(within(diff).getAllByText(/Changed:/)).toHaveLength(2);
    expect(within(diff).getByText("Stop scrolling.")).toBeTruthy();
    expect(screen.queryByText(/the script is now version/)).toBeNull();
    expect(screen.getByText("Relaunches on Renderer · 8 s · 720p")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Apply & relaunch" }));
    expect(applyAndLaunch).toHaveBeenCalledWith({ projectId: "p1", messageId: "m2", launch: { modelKey: "renderer", tier: "draft", durationS: 8, resolution: "720p", audio: true } });
    fireEvent.click(screen.getByRole("button", { name: "Apply only" }));
    expect(apply).toHaveBeenCalledWith({ projectId: "p1", messageId: "m2" });
  });

  it("warns when the script moved on since the request, and names a new actor", () => {
    messages = [{ id: "m2", role: "assistant", content: proposal.summary, proposal: { ...proposal, actorId: "a2" }, baseScriptId: "s1", appliedScriptId: null }];
    renderPanel([v1, v2]);
    expect(screen.getByText("Compared with version 2")).toBeTruthy();
    expect(screen.getByText("Asked on version 1; the script has since changed to version 2. Applying adds these lines as version 3, without version 2's changes.")).toBeTruthy();
    expect(screen.getByText("Marcus")).toBeTruthy();
  });

  it("says when a request came before the first version, and never claims to replace one", () => {
    messages = [{ id: "m2", role: "assistant", content: proposal.summary, proposal, baseScriptId: null, appliedScriptId: null }];
    renderPanel([v1]);
    expect(screen.getByText("Asked before the script had a version. Applying adds these lines as version 2.")).toBeTruthy();
    expect(screen.queryByText(/none|replaces/)).toBeNull();
    cleanup();
    renderPanel([]);
    expect(screen.getByText("First script")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("marks an applied proposal and offers no second apply", () => {
    messages = [{ id: "m2", role: "assistant", content: proposal.summary, proposal, baseScriptId: "s1", appliedScriptId: "s2" }];
    renderPanel([v1, v2]);
    expect(screen.getByText("Applied as version 2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Apply/ })).toBeNull();
  });

  it("refuses to relaunch a proposal the model cannot fit, and says so", () => {
    const long = { ...proposal, lines: [{ role: "hook", text: Array.from({ length: 30 }, (_, i) => `w${i}`).join(" "), emotion: "neutral" }] };
    messages = [{ id: "m2", role: "assistant", content: "Long", proposal: long, baseScriptId: "s1", appliedScriptId: null }];
    renderPanel();
    expect(screen.queryByRole("button", { name: "Apply & relaunch" })).toBeNull();
    expect(screen.getByText(/About 12 s to say: Renderer renders at most 10 s/)).toBeTruthy();
    expect(screen.getByText(/≈12 s of 8 s/).className).toContain("text-warning");
  });

  it("shows the raw answer when it was not a script", () => {
    messages = [{ id: "m2", role: "assistant", content: "Sure! Here is a hook: hi", proposal: null, baseScriptId: "s1", appliedScriptId: null }];
    renderPanel();
    expect(screen.getByText(/could not be read as a script/)).toBeTruthy();
    expect(screen.getByText("Sure! Here is a hook: hi")).toBeTruthy();
  });

  it("explains why the chat cannot run, and keeps the field closed", () => {
    provider = { id: "webllm", label: "This browser", modelId: "Qwen", problem: "The script chat runs its model on the GPU through WebGPU, which this browser lacks.", wordsPerSecond: 2.5 };
    renderPanel();
    expect(screen.getByText(/WebGPU, which this browser lacks/)).toBeTruthy();
    expect((screen.getByLabelText("Ask for a change") as HTMLTextAreaElement).disabled).toBe(true);
  });
});
