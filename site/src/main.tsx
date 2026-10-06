import "./process-shim";
import "./fonts";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { afterFirstPaint } from "./first-paint";
import { registerMediaWorker } from "./media";
import { failInterruptedRenders } from "./render/runner";
import { router } from "./routes";

registerMediaWorker();
failInterruptedRenders();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

// The studio's housekeeping needs its server side and database, which load
// once the shell has painted (site/src/server-link.ts): finished renders kept,
// files nothing refers to cleared, and analyses left waiting (or cut short
// by a closed tab) resumed.
void afterFirstPaint().then(() => {
  void import("./server-link").then(({ createBrowserContext, keepRecordedRenders }) => {
    void keepRecordedRenders();
    void createBrowserContext().then(
      (ctx) => ctx.library?.schedule(),
      () => {},
    );
  });
  void import("./data/local-data").then(({ pruneUnreferencedMedia }) => pruneUnreferencedMedia());
});
