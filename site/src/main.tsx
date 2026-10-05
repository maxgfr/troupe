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
import { keepRecordedRenders } from "./trpc";

registerMediaWorker();
failInterruptedRenders();
void keepRecordedRenders();
void pruneUnreferencedMedia();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
