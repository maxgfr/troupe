import type { Page } from "@playwright/test";

// Checks the site's specs share.

// The word that would sell the browser edition short, spelled d[e]mo so the
// repository itself never says it (scripts/check-wording.ts).
export const TRIAL_WORD = /\bd[e]mo\b/i;

// Collects page errors and console errors into `errors`. GitHub Pages answers
// a deep link with 404.html (the app) and a 404 status, which the browser
// logs: that one message is expected, for a page's own address only. A 404 on
// anything the page fetches is still an error.
export function watchConsole(page: Page, errors: string[] = []): string[] {
  const documents = new Set<string>();
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents.add(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().includes("status of 404") && documents.has(message.location().url)) return;
    errors.push(message.text());
  });
  return errors;
}

// Records, into the returned list, every time the studio says it could not
// load or be initialized, on the page loaded now and on every page loaded
// after it: while the tables are rebuilt the studio must never look broken.
export async function watchForBrokenStudio(page: Page): Promise<string[]> {
  const glimpses: string[] = [];
  await page.exposeFunction("reportGlimpse", (text: string) => glimpses.push(text));
  const observe = () => {
    new MutationObserver(() => {
      const text = document.querySelector("main")?.textContent ?? "";
      if (/could not (load|be initialized)/.test(text)) (window as unknown as { reportGlimpse: (t: string) => void }).reportGlimpse(text.slice(0, 120));
    }).observe(document, { childList: true, subtree: true, characterData: true });
  };
  await page.addInitScript(observe);
  // The page already open, unless it is still blank.
  if (page.url() !== "about:blank") await page.evaluate(observe);
  return glimpses;
}
