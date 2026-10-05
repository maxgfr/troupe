import type { LocalData } from "~/app/_components/edition";

// What the browser says about the studio's storage (the Storage API). Every
// answer is optional: an older browser, or one that refuses, reports nothing
// rather than failing.

const manager = (): StorageManager | undefined => (typeof navigator === "undefined" ? undefined : navigator.storage);

export const storage: LocalData["storage"] = {
  async estimate() {
    const estimate = await manager()?.estimate?.().catch(() => undefined);
    if (!estimate || estimate.usage === undefined || estimate.quota === undefined) return null;
    return { usageBytes: estimate.usage, quotaBytes: estimate.quota };
  },
  async persisted() {
    const persisted = manager()?.persisted;
    return persisted ? persisted.call(manager()).catch(() => null) : null;
  },
  async persist() {
    const persist = manager()?.persist;
    return persist ? persist.call(manager()).catch(() => null) : null;
  },
};
