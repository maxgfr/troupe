// The landing page's script: the fonts and styles, the copy button on the
// quick start, and the step list's links into the presentation video. The
// page reads fine without it.
import "@fontsource-variable/geist";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/jetbrains-mono";
import "./landing.css";

import { clock, parseChapters } from "./chapters";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Copy buttons: data-copy names the element whose text they copy.
for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-copy]")) {
  const source = document.getElementById(button.dataset.copy!);
  const status = button.closest(".terminal")?.querySelector<HTMLElement>(".copy__status");
  const label = button.querySelector<HTMLElement>(".copy__label");
  if (!source || !navigator.clipboard) continue;
  let reset: number | undefined;
  button.hidden = false;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(source.textContent ?? "");
    } catch {
      if (status) status.textContent = "Copying is blocked here: select the commands instead.";
      return;
    }
    button.dataset.copied = "";
    if (label) label.textContent = "Copied";
    if (status) status.textContent = "Commands copied.";
    window.clearTimeout(reset);
    reset = window.setTimeout(() => {
      delete button.dataset.copied;
      if (label) label.textContent = "Copy";
      if (status) status.textContent = "";
    }, 2000);
  });
}

// The video: its poster carries the play button, so the browser's controls
// (and the loading spinner some show before anything loads) wait for the
// first play. Without this script the controls are there from the start.
const video = document.querySelector<HTMLVideoElement>("#watch video");
const playButton = document.querySelector<HTMLButtonElement>(".screen__play");
function start(at?: number) {
  if (!video) return;
  if (playButton && !playButton.hidden) {
    playButton.hidden = true;
    video.controls = true;
  }
  const play = () => {
    if (at !== undefined) video.currentTime = at;
    void video.play().catch(() => undefined);
  };
  if (at === undefined || video.readyState >= 1) play();
  else {
    video.addEventListener("loadedmetadata", play, { once: true });
    video.load();
  }
  video.focus({ preventScroll: true });
}
if (video && playButton) {
  video.controls = false;
  playButton.hidden = false;
  playButton.addEventListener("click", () => start());
}

// The step list jumps the video to where each step starts. The times come
// from the video's own chapters, so a new cut keeps them right.
async function linkSteps() {
  const buttons = document.querySelectorAll<HTMLButtonElement>("button[data-seek]");
  if (!video || buttons.length === 0) return;
  let chapters: ReturnType<typeof parseChapters>;
  try {
    const response = await fetch(new URL("demo/troupe-demo-chapters.vtt", document.baseURI));
    chapters = response.ok ? parseChapters(await response.text()) : [];
  } catch {
    return;
  }
  for (const button of buttons) {
    const chapter = chapters.find((c) => c.id === button.dataset.seek);
    if (!chapter) continue;
    const time = button.querySelector(".cue__time");
    if (time) time.textContent = clock(chapter.start);
    // The name starts with the visible text ("0:13 Watch"), then says what.
    button.setAttribute("aria-label", `${clock(chapter.start)} Watch: ${chapter.title}`);
    button.hidden = false;
    button.addEventListener("click", () => {
      start(chapter.start);
      video.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
    });
  }
}

void linkSteps();
