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
- **Stage light**: a soft wash at the top of every page (and of the landing
  page), behind the bar and the title: cobalt by default, in the project's
  actor's hue on a project's pages (`actorHue`, the colour their portrait
  and videos carry). It glides from one hue to the next and never sits
  under body text at more than a few points of lightness.

## Colour

OKLCH tokens in `src/styles/design-tokens.json`, mirrored in
`src/styles/design-tokens.css` and checked by `tokens.test.ts`.

| Role | Dark (default) | Light | Use |
|---|---|---|---|
| background | `oklch(0.15 0.02 255)` | `oklch(1 0 0)` | Stage |
| surface | `oklch(0.19 0.025 255)` | `oklch(0.96 0.008 255)` | Fields, quiet panels, empty states |
| raised | `oklch(0.22 0.028 255)` | `oklch(1 0 0)` | Panels that hold controls (launch, models, proposals), sheets, dialogs |
| foreground | `oklch(0.93 0.01 250)` | `oklch(0.22 0.02 255)` | Text (≥ 7:1) |
| muted | `oklch(0.66 0.02 250)` | `oklch(0.45 0.02 255)` | Secondary text (≥ 4.5:1) |
| primary | `oklch(0.7 0.14 250)` | `oklch(0.46 0.15 252)` | Actions, links, focus, selection, progress |
| on-primary | `oklch(0.15 0.02 255)` | `oklch(1 0 0)` | Text on cobalt |
| secondary (spot) | `oklch(0.9 0.06 90)` | `oklch(0.8 0.1 88)` | Votes, adopting a comparison winner |
| on-secondary | `oklch(0.28 0.05 85)` | `oklch(0.28 0.05 85)` | Ink on gold |
| success | `oklch(0.72 0.15 155)` | `oklch(0.45 0.12 155)` | Finished render, ready model |
| warning | `oklch(0.75 0.15 70)` | `oklch(0.55 0.13 65)` | Model limits, unavailable models |
| danger | `oklch(0.62 0.21 15)` | `oklch(0.52 0.2 15)` | Failed render, destructive actions |

Hairlines (`--troupe-color-line`, `line-strong`) are the text colour at 12%
and 20%: structure (dividers, field and button outlines), never depth.

Rules: gold is never decoration; a model limit is a warning with a sentence
that explains it, shown before any call; real provider costs and durations are
set in mono and marked "est." when estimated.

## Typography

- Display: Bricolage Grotesque, for the lowercase "troupe" wordmark, page
  titles (32 px, 28 on phones, -0.02em), empty state titles and an actor's
  name on their portrait. Letter-spacing ≥ -0.03em.
- Interface: Geist; section titles 20 px semibold. Data: JetBrains Mono with
  `tabular-nums`.
- Scale 12/14/16/20/24/32; body line height 1.5, headings 1.1–1.2.

## Components

The vocabulary, screens and navigation are mapped in
[docs/PRODUCT-MAP.md](docs/PRODUCT-MAP.md); the shared pieces live in
`src/app/_components`.

- **Controls** (`ui.tsx`): `Button` / `ButtonLink` in five voices: primary
  (cobalt, semibold, a soft cobalt glow; one per view), secondary (hairline
  outline), outline (cobalt outline: a cobalt action that is not the
  view's main one), quiet (text, muted until hovered; quiet-primary and
  quiet-danger in colour) and danger (outlined, then solid in the
  confirmation). Sizes 36 / 40 / 48 px (sm is 40 on touch screens); press
  scales to 0.96. `chipClass` for one choice among a few: a pill, cobalt
  tint and ring when chosen. `fieldClass` for inputs, selects and text
  areas: surface fill, hairline, a 2 px focus ring. Classes passed to them
  add, never override (sizes come from their own options).
- **Status chips**: pills; a running job has a pulsing dot. On a poster,
  dark glass with the tone in the dot.
- **Icons** (`icons.tsx`): one 20 px grid, 1.6 stroke, round caps, in
  `currentColor`; no Unicode arrows standing in for icons.
- **Wordmark**: "troupe", Bricolage 700, line height 1; the "o" carries a
  gold ring that hugs the letter.
- **App shell**: a translucent top bar: the wordmark, Projects · Library ·
  Actors · Compare, then New project (primary) and Settings (sliders icon
  and name). Below 640 px the four sections move to a bottom tab bar (icon
  and label, the current one's icon cobalt) and the top bar keeps the
  wordmark, a New project icon button and the Settings icon. Pages arrive
  with a 150 ms fade. Shortcuts: `n`, `g` then a letter, `/`, `?` (listed in
  a dialog). The browser edition adds no banner: it is Troupe, not a
  preview of it.
- **Projects** (`/dashboard`): a grid of posters (4:5): the newest saved
  video standing on an early frame and playing muted while hovered or
  focused (still with reduced motion), else the actor's portrait; the
  stage (Script, Rendering, To review, Exported) on the picture, the title
  and platform · format · date below; a cobalt play button rises on hover.
  Empty: the cast in a row, "about two minutes" and the three steps. A
  warning says once when no model can render yet.
- **Wizard**: a stepper of four filling segments; each step asks its
  question as a section title. Platform → format (drawn to its shape) and
  model → language → actor (tall portraits, the name on the picture, a
  check when chosen). Back and Continue stay above the tab bar on phones.
  Model limits and language warnings appear inline.
- **Project header and tabs**: every project page opens on the actor's
  portrait (rounded square), the title in Bricolage and platform · format
  · language · actor, then the tabs Video · Script · Export (a cobalt
  underline marks the current one; Chat beside them below the large
  breakpoint).
- **Script tab**: lines as cue cards (role in small mono caps, the line at
  reading size, emotion chips that change at once and are saved after), an
  editor that opens on the current text, and earlier versions to restore.
- **Video tab**: the newest finished video is the star (no card around it,
  up to 560 px tall, glowing softly in the actor's hue); each render below
  is a row with a small still of its video, and the list announces job
  states in a live region; the raised launch panel only offers what the
  chosen model accepts. The script chat sits beside them, divided by a
  hairline (a bottom sheet below the large breakpoint): requests in a
  faint cobalt bubble, each proposal a raised card with its lines diffed against the
  current version (added on a success tint, rewritten on a cobalt tint, the
  old text struck through). The newest pending proposal's **Apply & relaunch**
  is gold: a decision awaits. A running render's bar fills with the progress
  the model reports (half full and glowing when it reports none); a finished
  one shows the video's real length. Every render is a draft until it is
  exported, which makes it final.
- **Export tab**: renders picked by their still, the platform as chips, then
  one primary action at a time: **Create export**, then
  **Download MP4** in its place. Downloads are named after the project, the
  model and the time, from the timeline and the export page alike.
- **Actors**: portrait cards (4:5) in 2 / 3 / 4 columns, the name in
  Bricolage on a dark scrim at the foot of the picture, gender · age ·
  style and the voice below; gender filters as chips.
- **Inspiration library**: a ledger, not a mood board. The add bar (one
  field for a link or a text, Upload beside it, the whole bar a drop zone,
  "It is my own content" below) and one quiet line of status dots for the
  tools that read the library. Then a sortable table (picture or kind glyph
  and title with the hook quoted below, kind, length in mono, two tag chips
  that filter, date in mono, status chip: waiting, reading in cobalt, ready,
  failed), two-line rows on phones; the search field above it swaps the table
  for passages ranked by meaning, each opening its item at its moment. The
  library chat sits beside it behind a hairline (below it on phones), its
  citations small mono numbers on a cobalt tint that open the item at the
  cited second. Idea cards are hairline-divided: title, mono word count,
  the lines with their role in small mono caps, and an outlined cobalt
  **Create project** (ten cards must not make ten primary buttons).
- **Library item**: the player, then the item on one time axis: hook (cobalt
  tint), body (surface) and call to action (success tint) as bands, the
  pictures at their seconds, a native range scrubber, mono ticks; every one
  of them seeks the player. Below: the hook quoted large with why it works,
  the structure with mono times, pace in mono, tone, tags, then the
  transcript with its current line on a cobalt tint. A reading item shows the
  glowing progress bar with the step in words.
- **Compare** (`/benchmark`): the comparisons as one hairline-divided list;
  opening one by its id sits behind a disclosure. One raised column per
  model, cost and latency in mono, the vote and "Adopt for project" in
  gold.
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
- Skeletons in the shape of what loads (posters, rows, panels) rather than
  spinners; empty states that teach the next step, on a surface tint, with
  a picture when one helps (the cast).

## Motion

- 150 ms ease-out and 250 ms ease-in-out; pictures zoom 3% over 500 ms on
  hover with an exponential ease-out. Generation progress is the only
  theatrical motion (a cobalt bar with a soft glow). `prefers-reduced-motion`
  turns transitions into crossfades: no zoom, no preview playback, no
  page fade.

## Radius and elevation

- Radius 8 (controls) / 12 (posters, rows) / 16 (panels, empty states);
  chips and status are pills. One elevation per element, a shadow or a
  hairline, never both: `--shadow-card` (dark `0 1px 2px rgb(0 0 0/.3), 0
  8px 24px rgb(0 0 0/.28)`, light `.06` / `.08`) and `--shadow-overlay`;
  in dark mode surfaces separate by tint first.
