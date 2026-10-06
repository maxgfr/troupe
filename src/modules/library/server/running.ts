// The analyses running in this process, by item: deleting an item stops its
// analysis at once (an analysis in another process notices at its next
// heartbeat). Kept on globalThis, so every bundle of the server (the
// routes, the background loop) shares one.

const state = globalThis as unknown as { troupeLibraryRunning?: Map<string, AbortController> };

function running(): Map<string, AbortController> {
  state.troupeLibraryRunning ??= new Map();
  return state.troupeLibraryRunning;
}

export function startAnalysis(itemId: string, parent?: AbortSignal): AbortController {
  const controller = new AbortController();
  if (parent) {
    if (parent.aborted) controller.abort(parent.reason);
    else parent.addEventListener("abort", () => controller.abort(parent.reason), { once: true });
  }
  running().set(itemId, controller);
  return controller;
}

export function endAnalysis(itemId: string, controller: AbortController): void {
  if (running().get(itemId) === controller) running().delete(itemId);
}

export function stopAnalysis(itemId: string): void {
  running().get(itemId)?.abort(new Error("The item was deleted."));
}
