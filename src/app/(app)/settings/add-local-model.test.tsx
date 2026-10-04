// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/trpc/react", () => ({ api: {} }));

import { AddLocalModelForm, type TemplateView } from "./add-local-model";

afterEach(cleanup);

const TEMPLATES: TemplateView[] = [
  { id: "ltx2-t2v", label: "LTX-2 (video + audio)", description: "Speaks.", vramGb: 24, verification: "contract", comfyuiVersion: "0.38.0", requiredFiles: [{ folder: "checkpoints", filename: "ltx-2-19b-dev-fp8.safetensors", url: "https://huggingface.co/x" }] },
  { id: "wan22-ti2v-5b", label: "Wan 2.2 TI2V 5B (silent)", description: "Silent.", vramGb: 8, verification: "contract", comfyuiVersion: "0.38.0", requiredFiles: [] },
];

describe("add a local model", () => {
  it("adds a bundled ComfyUI template with the Docker host address by default", () => {
    const onSave = vi.fn();
    render(<AddLocalModelForm templates={TEMPLATES} onTest={vi.fn()} onSave={onSave} />);
    expect(screen.getByText(/about 24 GB/)).toBeDefined();
    expect(screen.getByText(/not yet rendered end to end/)).toBeDefined();
    fireEvent.change(screen.getByLabelText("Workflow"), { target: { value: "wan22-ti2v-5b" } });
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));
    expect(onSave).toHaveBeenCalledWith({ family: "comfyui", label: "Wan 2.2 TI2V 5B (silent)", baseUrl: "http://host.docker.internal:8188", templateId: "wan22-ti2v-5b" });
  });

  it("describes an HTTP endpoint's capabilities and tests it before saving", () => {
    const onTest = vi.fn();
    render(<AddLocalModelForm templates={TEMPLATES} onTest={onTest} onSave={vi.fn()} />);
    fireEvent.click(screen.getByText("HTTP endpoint"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "GPU box" } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "http://192.168.1.20:8000" } });
    fireEvent.change(screen.getByLabelText("Token (optional)"), { target: { value: "secret" } });
    fireEvent.change(screen.getByLabelText("Clip lengths (seconds)"), { target: { value: "4, 8" } });
    fireEvent.change(screen.getByLabelText("Audio"), { target: { value: "optional" } });
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(onTest).toHaveBeenCalledWith({
      family: "http", label: "GPU box", baseUrl: "http://192.168.1.20:8000", token: "secret", fps: 24,
      capabilities: { aspectRatios: ["16:9", "9:16"], resolutions: ["720p"], durationsS: [4, 8], audio: "optional", dialogueLanguages: null },
    });
  });

  it("imports a custom workflow and refuses files over 2 MB", async () => {
    const onSave = vi.fn();
    render(<AddLocalModelForm templates={TEMPLATES} onTest={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Workflow"), { target: { value: "custom" } });
    const input = screen.getByLabelText("API workflow file") as HTMLInputElement;
    const big = new File(["x".repeat(2 * 1024 * 1024 + 1)], "big.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [big] } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/2 MB/));
    const wf = new File([JSON.stringify({ "6": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}" } } })], "wf.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [wf] } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Add model" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ family: "comfyui", workflow: { "6": { class_type: "CLIPTextEncode" } }, frameRule: "any" });
  });
});
