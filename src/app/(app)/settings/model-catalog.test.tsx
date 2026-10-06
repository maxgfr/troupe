// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/trpc/react", () => ({ api: {} }));

import { DefaultModelPicker, ModelCatalogList, type CatalogModelView } from "./model-catalog";

afterEach(cleanup);

const model = (key: string, patch: Partial<CatalogModelView> = {}): CatalogModelView => ({
  key,
  label: key,
  vendor: "v",
  kind: "cloud",
  capabilities: { resolutions: ["480p", "720p"], durationsS: [4, 8], audio: "optional" },
  defaults: { resolution: "720p", durationS: 8, audio: true },
  pricePerSecondUsd: null,
  timeoutS: 1800,
  enabled: true,
  archived: false,
  status: "ready",
  statusDetail: null,
  ...patch,
});

describe("model catalog settings", () => {
  it("shows each model's status and toggles it", () => {
    const onToggle = vi.fn();
    render(
      <ModelCatalogList
        models={[
          model("Veo"),
          model("Kling", { status: "missing-credentials", statusDetail: "Add a fal.ai key in Settings." }),
        ]}
        reports={{}}
        onToggle={onToggle}
        onTest={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("Ready")).toBeDefined();
    expect(screen.getByText("Add a fal.ai key in Settings.")).toBeDefined();
    fireEvent.click(screen.getByRole("switch", { name: "Use Veo" }));
    expect(onToggle).toHaveBeenCalledWith("Veo", false);
  });

  it("says a local model was out of reach at its last test, with the reason, instead of Ready", () => {
    render(
      <ModelCatalogList
        models={[
          model("Box", {
            kind: "local",
            lastTest: {
              ok: false,
              message: "Could not reach http://127.0.0.1:1. Is the server running and reachable from Troupe?",
              at: "2026-10-06T18:00:00Z",
            },
          }),
          model("Renderer", {
            kind: "local",
            lastTest: { ok: true, message: "Renderer is reachable.", at: "2026-10-06T18:00:00Z" },
          }),
        ]}
        reports={{}}
        onToggle={vi.fn()}
        onTest={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("Added, not reachable")).toBeDefined();
    expect(screen.getByRole("status").textContent).toBe(
      "Could not reach http://127.0.0.1:1. Is the server running and reachable from Troupe?",
    );
    expect(screen.getAllByText("Ready")).toHaveLength(1);
  });

  it("saves launch defaults, price and time limit", () => {
    const onSave = vi.fn();
    render(
      <ModelCatalogList
        models={[model("Seedance")]}
        reports={{}}
        onToggle={vi.fn()}
        onTest={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText("Resolution"), { target: { value: "480p" } });
    fireEvent.change(screen.getByLabelText("Price per second (USD)"), { target: { value: "0.05" } });
    fireEvent.change(screen.getByLabelText("Give up after (minutes)"), { target: { value: "45" } });
    fireEvent.click(screen.getByLabelText("With audio by default"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("Seedance", {
      defaults: { resolution: "480p", durationS: 8, audio: false },
      pricePerSecondUsd: 0.05,
      timeoutS: 2700,
    });
  });

  it("refuses a negative price", () => {
    render(
      <ModelCatalogList
        models={[model("Seedance")]}
        reports={{}}
        onToggle={vi.fn()}
        onTest={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Price per second (USD)"), { target: { value: "-1" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers only launchable models as default and explains the fallback", () => {
    const onChange = vi.fn();
    render(
      <DefaultModelPicker
        models={[model("Veo", { enabled: false }), model("Kling")]}
        savedKey="Veo"
        effectiveKey="Kling"
        onChange={onChange}
      />,
    );
    const values = [...(screen.getByLabelText("Default model") as HTMLSelectElement).options].map((o) => o.value);
    expect(values).toEqual(["", "Kling"]);
    expect(screen.getByText(/saved default is unavailable/)).toBeDefined();
    fireEvent.change(screen.getByLabelText("Default model"), { target: { value: "Kling" } });
    expect(onChange).toHaveBeenCalledWith("Kling");
  });
});
