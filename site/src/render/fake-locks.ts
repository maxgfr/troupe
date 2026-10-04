// Test double for navigator.locks: exclusive locks only, granted in request
// order, with a hook called as each one is released.

interface Waiter {
  name: string;
  run: () => void;
}

export class FakeLockManager {
  private held = new Set<string>();
  private waiting: Waiter[] = [];
  onRelease: ((name: string) => void) | null = null;

  request<T>(name: string, callback: () => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.held.add(name);
        Promise.resolve()
          .then(callback)
          .then(resolve, reject)
          .finally(() => {
            this.onRelease?.(name);
            this.held.delete(name);
            this.next();
          });
      };
      if (this.held.has(name)) this.waiting.push({ name, run });
      else run();
    });
  }

  async query(): Promise<{ held: { name: string }[]; pending: { name: string }[] }> {
    return { held: [...this.held].map((name) => ({ name })), pending: this.waiting.map(({ name }) => ({ name })) };
  }

  private next() {
    const index = this.waiting.findIndex((w) => !this.held.has(w.name));
    if (index >= 0) this.waiting.splice(index, 1)[0]!.run();
  }
}

export function installFakeLocks(): FakeLockManager {
  const locks = new FakeLockManager();
  Object.defineProperty(globalThis.navigator, "locks", { value: locks, configurable: true });
  return locks;
}
