import { describe, expect, it } from "vitest";

import { actorPictureUrl, DEFAULT_PICTURES_BASE } from "./pictures";

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
