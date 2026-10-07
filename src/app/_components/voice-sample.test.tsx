// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActorGrid } from "~/app/(app)/actors/actor-grid";
import { ActorStep } from "~/app/(app)/projects/new/wizard-steps";
import { VoiceSampleButton } from "./voice-sample";

// jsdom has no media playback: play() resolves and says "playing", pause()
// says "pause", as a browser does.
let play: ReturnType<typeof vi.fn>;
beforeEach(() => {
  play = vi.fn(function (this: HTMLMediaElement) {
    queueMicrotask(() => this.dispatchEvent(new Event("playing")));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play as never);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const aiko = "/actors/aiko-03/v1/front.webp";
const tom = "/actors/tom-23/v1/front.webp";

async function press(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
  });
}

describe("VoiceSampleButton", () => {
  it("names what it plays and loads nothing until pressed", () => {
    const { container } = render(<VoiceSampleButton name="Aiko" portraitUrl={aiko} />);
    const button = screen.getByRole("button", { name: "Play Aiko's voice" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    const audio = container.querySelector("audio")!;
    expect(audio.getAttribute("preload")).toBe("none");
    expect([...audio.querySelectorAll("source")].map((s) => [s.getAttribute("src"), s.getAttribute("type")])).toEqual([
      ["/actors/aiko-03/v1/voice.webm", 'audio/webm; codecs="opus"'],
      ["/actors/aiko-03/v1/voice.m4a", 'audio/mp4; codecs="mp4a.40.2"'],
    ]);
    expect(play).not.toHaveBeenCalled();
  });

  it("plays, then stops on a second press or at the end of the sample", async () => {
    const { container } = render(<VoiceSampleButton name="Aiko" portraitUrl={aiko} />);
    const button = screen.getByRole("button", { name: "Play Aiko's voice" });
    await press(button);
    expect(play).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await press(button);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await press(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    act(() => {
      container.querySelector("audio")!.dispatchEvent(new Event("ended"));
    });
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("plays one sample at a time: starting one stops the other", async () => {
    render(
      <>
        <VoiceSampleButton name="Aiko" portraitUrl={aiko} />
        <VoiceSampleButton name="Tom" portraitUrl={tom} />
      </>,
    );
    const first = screen.getByRole("button", { name: "Play Aiko's voice" });
    const second = screen.getByRole("button", { name: "Play Tom's voice" });
    await press(first);
    await press(second);
    expect(first.getAttribute("aria-pressed")).toBe("false");
    expect(second.getAttribute("aria-pressed")).toBe("true");
  });

  it("goes away when the sample cannot load, and for an actor without a picture", async () => {
    const { container } = render(<VoiceSampleButton name="Aiko" portraitUrl="/actors/aiko-03/v9/front.webp" />);
    await press(screen.getByRole("button", { name: "Play Aiko's voice" }));
    act(() => {
      const sources = container.querySelectorAll("source");
      sources[sources.length - 1]!.dispatchEvent(new Event("error"));
    });
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    // Remembered: the same missing sample does not offer its button again.
    render(<VoiceSampleButton name="Aiko" portraitUrl="/actors/aiko-03/v9/front.webp" />);
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    render(<VoiceSampleButton name="Aiko" portraitUrl={null} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("stops when it leaves the page", async () => {
    const { unmount } = render(<VoiceSampleButton name="Aiko" portraitUrl={aiko} />);
    await press(screen.getByRole("button", { name: "Play Aiko's voice" }));
    const paused = vi.mocked(HTMLMediaElement.prototype.pause);
    paused.mockClear();
    unmount();
    expect(paused).toHaveBeenCalled();
  });
});

describe("voice samples on the actor cards", () => {
  const actor = {
    id: "a1",
    name: "Aiko",
    style: "sporty",
    ageRange: "35-44",
    status: "active",
    portraitUrl: aiko,
  };

  it("plays an actor's voice in the wizard without choosing them", async () => {
    const onActor = vi.fn();
    render(<ActorStep pending={false} actors={[actor]} actorId={null} onActor={onActor} />);
    await press(screen.getByRole("button", { name: "Play Aiko's voice" }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(onActor).not.toHaveBeenCalled();
    expect((screen.getByRole("radio") as HTMLInputElement).checked).toBe(false);
  });

  it("plays an actor's voice on the Actors page", async () => {
    render(
      <ActorGrid
        actors={[{ ...actor, workspaceId: null, gender: "female", voiceProfile: "bright and fast", status: "active" }]}
      />,
    );
    await press(screen.getByRole("button", { name: "Play Aiko's voice" }));
    expect(play).toHaveBeenCalledTimes(1);
  });
});
