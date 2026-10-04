import { resetDatabase } from "./db/client";
import { clearMediaFiles } from "./media";

// "Reset demo data": an empty studio in this tab and every other open one.
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("troupe-demo");

channel?.addEventListener("message", (event) => {
  if (event.data === "reset") window.location.reload();
});

export async function resetDemoData(): Promise<void> {
  await resetDatabase();
  await clearMediaFiles();
  channel?.postMessage("reset");
  window.location.assign(`${import.meta.env.BASE_URL}app/dashboard`);
}
