import { describe, expect, it } from "vitest";

import {
  actorPictureUrl,
  actorVoiceSamples,
  anyActorPictureUrl,
  customPicturePath,
  DEFAULT_PICTURES_BASE,
  isCustomPicture,
} from "./pictures";

describe("anyActorPictureUrl", () => {
  it("serves a made actor's pictures from the studio's route, the cast from its folder", () => {
    const path = customPicturePath("0b6f6c3e-2d0f-4a4e-9a51-5b1b2b8c9d10", 1, "front.jpg");
    expect(path).toBe("custom-actors/0b6f6c3e-2d0f-4a4e-9a51-5b1b2b8c9d10/v1/front.jpg");
    expect(isCustomPicture(path)).toBe(true);
    expect(anyActorPictureUrl("/actors", path)).toBe(
      "/api/actor-pictures/0b6f6c3e-2d0f-4a4e-9a51-5b1b2b8c9d10/v1/front.jpg",
    );
    expect(anyActorPictureUrl("/actors", "actors/lea-01/v1/front.webp")).toBe("/actors/lea-01/v1/front.webp");
  });
});

describe("actorPictureUrl", () => {
  it("serves the checked-in cast from the app's public folder by default", () => {
    expect(actorPictureUrl(DEFAULT_PICTURES_BASE, "actors/lea-01/v1/front.webp")).toBe("/actors/lea-01/v1/front.webp");
  });

  it("points at another folder or host, with or without a trailing slash", () => {
    expect(actorPictureUrl("/troupe/actors/", "actors/lea-01/v1/front.webp")).toBe(
      "/troupe/actors/lea-01/v1/front.webp",
    );
    expect(actorPictureUrl("https://cdn.example.com/cast", "actors/tom-23/v2/happy.webp")).toBe(
      "https://cdn.example.com/cast/tom-23/v2/happy.webp",
    );
  });
});

describe("actorVoiceSamples", () => {
  it("finds an actor's voice sample beside their front picture, Opus first then AAC", () => {
    expect(actorVoiceSamples("/actors/lea-01/v1/front.webp")).toEqual([
      { src: "/actors/lea-01/v1/voice.webm", type: 'audio/webm; codecs="opus"' },
      { src: "/actors/lea-01/v1/voice.m4a", type: 'audio/mp4; codecs="mp4a.40.2"' },
    ]);
    expect(actorVoiceSamples("https://cdn.example.com/cast/tom-23/v2/front.webp")?.[0]?.src).toBe(
      "https://cdn.example.com/cast/tom-23/v2/voice.webm",
    );
  });

  it("has none for an actor without a front picture or with a picture of another name", () => {
    expect(actorVoiceSamples(null)).toBeNull();
    expect(actorVoiceSamples(undefined)).toBeNull();
    expect(actorVoiceSamples("/actors/custom/portrait.png")).toBeNull();
  });
});
