// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScriptComposer } from "./script-composer";
import { ScriptVersions } from "./script-versions";

afterEach(cleanup);

describe("script editing", () => {
  it("opens on the current version and saves only a real change", () => {
    const onSave = vi.fn();
    render(<ScriptComposer pending={false} enabled initialText={"Hook.\nCall to action."} onSave={onSave} />);
    const box = screen.getByLabelText("Edit script") as HTMLTextAreaElement;
    expect(box.value).toBe("Hook.\nCall to action.");
    const save = screen.getByRole("button", { name: "Save as new version" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "Hook.\nBuy it now." } });
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith("Hook.\nBuy it now.");
  });

  it("lists earlier versions newest first and restores one", () => {
    const onRestore = vi.fn();
    render(
      <ScriptVersions
        currentId="s3"
        onRestore={onRestore}
        versions={[
          { id: "s1", version: 1, estimatedDurationS: 2, lines: [{ text: "First take." }] },
          { id: "s2", version: 2, estimatedDurationS: 3, lines: [{ text: "Second take." }] },
          { id: "s3", version: 3, estimatedDurationS: 3, lines: [{ text: "Current." }] },
        ]}
      />,
    );
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual(["Restore v2", "Restore v1"]);
    fireEvent.click(screen.getByRole("button", { name: "Restore v1" }));
    expect(onRestore).toHaveBeenCalledWith("s1");
  });
});
