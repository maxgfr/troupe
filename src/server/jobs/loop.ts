const running = new Map<string, () => void>();

// Run `tick` every `intervalMs`, one pass at a time, forever. A failing pass
// is logged and retried on the next tick. Starting the same loop twice (dev
// reloads, a second import) is a no-op. Returns a stop function.
export function startLoop(name: string, tick: () => Promise<unknown>, intervalMs: number): () => void {
  const existing = running.get(name);
  if (existing) return existing;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const run = async () => {
    try {
      await tick();
    } catch (error) {
      console.error(
        JSON.stringify({ event: `${name}.error`, message: error instanceof Error ? error.message : String(error) }),
      );
    }
    if (!stopped) timer = setTimeout(() => void run(), intervalMs);
  };
  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    running.delete(name);
  };
  running.set(name, stop);
  void run();
  return stop;
}
