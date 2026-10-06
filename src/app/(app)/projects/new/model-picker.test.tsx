// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelPicker } from "./model-picker";
import type { ModelOptionView } from "../model-choice";

afterEach(cleanup);

const base = {
  capabilities: {
    aspectRatios: ["9:16"],
    resolutions: ["720p"],
    durationsS: [8],
    audio: "always" as const,
    dialogueLanguages: null,
  },
  defaults: { resolution: "720p", durationS: 8, audio: true },
  pricePerSecondUsd: null,
  unavailableReason: null,
  compatible: true,
  warnings: [] as string[],
};
const OPTIONS: ModelOptionView[] = [
  {
    ...base,
    key: "veo-3.1-fast",
    label: "Veo 3.1 Fast",
    vendor: "Google",
    kind: "cloud",
    available: true,
    warnings: ["Veo 3.1 Fast has only been tried with English dialogue."],
  },
  { ...base, key: "kling-3.0", label: "Kling 3.0", vendor: "Kling via fal.ai", kind: "cloud", available: true },
  {
    ...base,
    key: "local-wan",
    label: "Wan 2.2",
    vendor: "ComfyUI",
    kind: "local",
    available: false,
    unavailableReason: "ComfyUI is not reachable.",
  },
];

describe("model picker", () => {
  it("lists models with their vendor, cloud/local kind and why one is unavailable", () => {
    render(<ModelPicker options={OPTIONS} value="veo-3.1-fast" defaultKey="kling-3.0" onChange={() => undefined} />);
    expect(screen.getByRole("radio", { name: /Kling 3\.0/ })).toBeDefined();
    expect(screen.getByText("local")).toBeDefined();
    expect((screen.getByRole("radio", { name: /Wan 2\.2/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("ComfyUI is not reachable.")).toBeDefined();
    expect(screen.getByText("· default")).toBeDefined();
    expect(screen.getByRole("status").textContent).toMatch(/English dialogue/);
  });

  it("reports the picked model", () => {
    const onChange = vi.fn();
    render(<ModelPicker options={OPTIONS} value="veo-3.1-fast" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /Kling 3\.0/ }));
    expect(onChange).toHaveBeenCalledWith("kling-3.0");
  });

  it("points to Settings when nothing is configured", () => {
    render(<ModelPicker options={[]} value={null} onChange={() => undefined} />);
    expect(screen.getByRole("link", { name: /Settings/ }).getAttribute("href")).toBe("/settings");
  });
});
