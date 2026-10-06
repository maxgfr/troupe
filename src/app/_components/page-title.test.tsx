// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { pageTitle, usePageTitle } from "./page-title";

afterEach(cleanup);

function Page({ parts }: { parts: (string | null | undefined)[] }) {
  usePageTitle(...parts);
  return null;
}

describe("page titles", () => {
  it("name the screen, then what it belongs to, then Troupe", () => {
    expect(pageTitle("Projects")).toBe("Projects · Troupe");
    expect(pageTitle("Script", "Cold brew mornings")).toBe("Script · Cold brew mornings · Troupe");
    expect(pageTitle()).toBe("Troupe");
  });

  it("set the document's title, skipping what is not known yet", () => {
    render(<Page parts={["Script", undefined]} />);
    expect(document.title).toBe("Script · Troupe");
    render(<Page parts={["Video", "Cold brew mornings"]} />);
    expect(document.title).toBe("Video · Cold brew mornings · Troupe");
  });
});
