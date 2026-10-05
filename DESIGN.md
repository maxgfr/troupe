# Design

A control room before the show: a cobalt-night stage (the blue-black background
is the surface), cobalt instrument light for interaction, and a pale gold
spotlight for whatever waits on a human decision. Dark is the primary theme,
because renders are judged in it; the light "daytime studio" theme is complete.
**Bricolage Grotesque** for brand moments, **Geist** for the interface,
**JetBrains Mono** for costs, durations and other technical data.

## Theme

- `:root` is dark; light comes from `prefers-color-scheme: light` and the
  `[data-theme="light"|"dark"]` overrides set in Settings (saved per device).
- Restrained: cobalt covers at most about 10% of a screen and the videos bring
  the colour. Gold is rarer still and only means "your decision is awaited".

## Colour

OKLCH tokens in `src/styles/design-tokens.json`, mirrored in
`src/styles/design-tokens.css` and checked by `tokens.test.ts`.

| Role | Dark (default) | Light | Use |
|---|---|---|---|
| background | `oklch(0.15 0.02 255)` | `oklch(1 0 0)` | Stage |
| surface | `oklch(0.19 0.025 255)` | `oklch(0.96 0.008 255)` | Panels, rows, bars |
| foreground | `oklch(0.93 0.01 250)` | `oklch(0.22 0.02 255)` | Text (≥ 7:1) |
| muted | `oklch(0.66 0.02 250)` | `oklch(0.45 0.02 255)` | Secondary text (≥ 4.5:1) |
| primary | `oklch(0.7 0.14 250)` | `oklch(0.5 0.15 250)` | Actions, links, focus, selection, progress |
| on-primary | `oklch(0.15 0.02 255)` | `oklch(1 0 0)` | Text on cobalt |
| secondary (spot) | `oklch(0.9 0.06 90)` | `oklch(0.8 0.1 88)` | Votes, adopting a comparison winner |
| on-secondary | `oklch(0.28 0.05 85)` | `oklch(0.28 0.05 85)` | Ink on gold |
| success | `oklch(0.72 0.15 155)` | `oklch(0.52 0.14 155)` | Finished render, ready model |
| warning | `oklch(0.75 0.15 70)` | `oklch(0.6 0.14 70)` | Model limits, unavailable models |
| danger | `oklch(0.62 0.21 15)` | `oklch(0.52 0.2 15)` | Failed render, destructive actions |

Rules: gold is never decoration; a model limit is a warning with a sentence
that explains it, shown before any call; real provider costs and durations are
set in mono and marked "est." when estimated.

## Typography

- Display: Bricolage Grotesque, for the lowercase "troupe" wordmark and empty
  state titles. Letter-spacing ≥ -0.03em.
- Interface: Geist. Data: JetBrains Mono with `tabular-nums`.
- Scale 12/14/16/20/24/32; body line height 1.5, headings 1.2.

## Components

- **Wordmark**: "troupe", Bricolage 700; the "o" carries a gold ring.
- **App shell**: top bar with Dashboard · Actors · Benchmark and Settings, on
  one row down to 360 px (Settings becomes a sliders icon on phones). The
  browser edition adds no banner: it is Troupe, not a preview of it.
- **Dashboard**: each project shows its stage in words (Script, Rendering,
  To review, Exported), worked out from its renders and exports; a warning
  says once when no model can render yet.
- **Wizard**: platform → format (with the model picker) → language → actor.
  Model limits and language warnings appear inline.
- **Script**: lines with emotion chips, an editor that opens on the current
  text, and earlier versions to restore.
- **Project page**: the newest finished video is the star (no card around it);
  the timeline announces job states in a live region; the launch panel only
  offers what the chosen model accepts. The script chat sits beside them,
  divided by a hairline (a bottom sheet below the large breakpoint): requests
  on a surface tint, each proposal a card with its lines diffed against the
  current version (added on a success tint, rewritten on a cobalt tint, the
  old text struck through). The newest pending proposal's **Apply & relaunch**
  is gold: a decision awaits. A running render's bar fills with the progress
  the model reports (half full and glowing when it reports none); a finished
  one shows the video's real length. Every render is a draft until it is
  exported, which makes it final.
- **Export**: one primary action at a time: **Create export**, then
  **Download MP4** in its place. Downloads are named after the project, the
  model and the time, from the timeline and the export page alike.
- **Actor library**: `auto-fit minmax(280px, 1fr)` grid of portraits.
- **Benchmark lab**: one column per model, cost and latency in mono, the vote
  and "Adopt for project" in gold.
- **Settings**: default model, cloud models, the script chat, provider
  accounts, local models; every connection has a Test button. What only the
  self-hosted studio can do is said once, calmly, where the control would be,
  with a link to set it up. In the browser edition, **Your data** sits in one
  hairline-divided panel: storage used (mono figures) and whether the browser
  keeps it, Export / Import a backup (an import says what the file holds and
  asks before replacing anything), and **Delete all local data** last, in
  danger red, with an inline confirmation. A one-line note on where the data
  lives can be dismissed.
- **Landing page** (`/troupe/`, browser edition): the headline left-aligned in
  Bricolage, then the two editions on either side of the presentation video
  (a triptych on wide screens; browser edition, video, server on phones). The
  browser edition's "Open Troupe in your browser" is the one cobalt button;
  "Self-host with Docker" is outlined. Below: the steps of a project on one
  hairline axis, each with a piece of the studio and a mono time that jumps
  the video there; the cast uncropped and named; the editions as a table where
  what one cannot do is unlit (dim italic) with its reason; each model as a
  row with mono stubs (where it runs first, in cobalt) and a status dot that
  is filled only when it was rendered end to end. Hairlines, no cards. The
  video's poster carries its play button; the browser's controls appear on
  the first play.
- Skeletons rather than spinners; empty states that teach the next step.

## Motion

- 150 ms ease-out and 250 ms ease-in-out. Generation progress is the only
  theatrical motion (a cobalt bar with a soft glow). `prefers-reduced-motion`
  turns transitions into crossfades.

## Radius and elevation

- Radius 8 / 12 / 14. Shadows: card `0 1px 3px rgba(0,0,0,.08)`, overlay
  `0 8px 30px rgba(0,0,0,.16)`; in dark mode surfaces separate by tint first.
