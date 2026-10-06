// Resolves once the browser has painted the page's first content (the shell
// and the page's header, see the "first-contentful-paint" entry): the
// database's ~12 MB start to download after that, not ahead of it. A second
// and a half at most, for a browser that does not report paints.
export function afterFirstPaint(): Promise<void> {
  return new Promise((resolve) => {
    const painted = () => performance.getEntriesByName("first-contentful-paint").length > 0;
    if (typeof PerformanceObserver === "undefined" || painted()) return resolve();
    const observer = new PerformanceObserver(() => {
      if (!painted()) return;
      observer.disconnect();
      resolve();
    });
    try {
      observer.observe({ type: "paint", buffered: true });
    } catch {
      resolve();
    }
    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 1500);
  });
}
