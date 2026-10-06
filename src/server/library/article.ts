import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

// An article's title and words, without the page around it (Mozilla's
// Readability, the reader view of Firefox), parsed with linkedom: a DOM
// without scripts, styles or network, so nothing in the page runs.

export interface Article {
  title: string;
  text: string;
  siteName: string | null;
}

const tidy = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// "Three hooks | The Blog" → "Three hooks" when the site's name is known.
function cleanTitle(title: string, siteName: string | null): string {
  if (!siteName) return title;
  const escaped = siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return title.replace(new RegExp(`\\s*[|\\-–—·:]\\s*${escaped}\\s*$`, "i"), "").trim() || title;
}

export function extractArticle(html: string, url: string): Article {
  const { document } = parseHTML(html);
  const pageTitle = document.querySelector("title")?.textContent?.trim() ?? "";
  const siteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute("content")?.trim() || null;
  let parsed: ReturnType<Readability<string>["parse"]> = null;
  try {
    // Readability changes the document it reads: give it its own.
    parsed = new Readability(parseHTML(html).document as unknown as Document, { charThreshold: 200 }).parse();
  } catch {
    parsed = null;
  }
  if (parsed?.textContent?.trim()) {
    // Paragraphs keep their breaks: Readability's HTML, with block ends as new lines.
    const { document: content } = parseHTML(
      `<html><body>${(parsed.content ?? "").replace(/<\/(p|h[1-6]|li|blockquote|pre|div|tr)>/gi, "</$1>\n\n").replace(/<br\s*\/?>/gi, "\n")}</body></html>`,
    );
    const text = tidy(content.body?.textContent ?? parsed.textContent);
    const site = parsed.siteName?.trim() || siteName;
    return { title: cleanTitle(parsed.title?.trim() || pageTitle || url, site), text, siteName: site };
  }
  for (const node of document.querySelectorAll("script, style, noscript, template, nav, header, footer, svg"))
    node.remove();
  return { title: cleanTitle(pageTitle || url, siteName), text: tidy(document.body?.textContent ?? ""), siteName };
}
