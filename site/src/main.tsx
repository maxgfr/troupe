import "./process-shim";
import "./fonts";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { registerMediaWorker } from "./media";
import { failInterruptedRenders } from "./render/runner";
import { router } from "./routes";
import { pruneSettledRenders } from "./trpc";

registerMediaWorker();
failInterruptedRenders();
pruneSettledRenders();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
