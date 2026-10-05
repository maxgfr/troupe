import "./process-shim";
import "./fonts";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { pruneUnreferencedMedia } from "./data/local-data";
import { registerMediaWorker } from "./media";
import { failInterruptedRenders } from "./render/runner";
import { router } from "./routes";
import { createBrowserContext, keepRecordedRenders } from "./trpc";

registerMediaWorker();
failInterruptedRenders();
void keepRecordedRenders();
void pruneUnreferencedMedia();
// Analyses left waiting (or cut short by a closed tab) resume.
void createBrowserContext().then((ctx) => ctx.library?.schedule(), () => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
