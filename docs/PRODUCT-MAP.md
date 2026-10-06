# Product map

The single reference for what Troupe's screens are called, how you move
between them and which words and components they use. The self-hosted
studio, the browser edition, the landing page, the CLI and the docs follow
it; [DESIGN.md](../DESIGN.md) holds the visual system, [PRODUCT.md](../PRODUCT.md)
the principles.

## One product, two places

The **self-hosted studio** (Docker or a server) and the **browser edition**
(the static site, everything in the visitor's browser) run the same pages at
the same paths (`src/app/(app)`; the browser edition mounts them under
`/troupe/app`). What an edition cannot do is said once, calmly, where the
control would be ("Needs the self-hosted studio"), never hidden and never
apologised for. The **landing page** (`/troupe/`) introduces both and opens
the browser edition.

## Navigation

- **Top bar** on every page: the wordmark (to Projects), then **Projects ·
  Library · Actors · Compare**, then **New project** and **Settings** on the
  right.
- **Phones** (below 640 px): the top bar keeps the wordmark, New project and
  Settings; the four sections move to a **bottom tab bar** with an icon and a
  label each.
- **Project tabs**: every project page carries the project header (actor,
  title, platform · format · language) and the tabs **Video · Script ·
  Export**. Phones add **Chat** beside the tabs (the chat opens as a bottom
  sheet); wider screens keep the chat beside the timeline.
- **Keyboard**: `n` new project; `g` then `p` / `l` / `a` / `c` / `s` goes to
  Projects, Library, Actors, Compare, Settings; `/` searches the library; `?`
  lists the shortcuts. Shortcuts never fire while typing.

## Screens

| Path | Title | What it is for | Primary action | Empty state teaches |
|---|---|---|---|---|
| `/dashboard` | Projects | Every project with its newest video as poster and its stage | New project | The three steps to a first video, with the cast |
| `/projects/new` | New project | Platform → format and model → language → actor | Continue, then Create project | — |
| `/projects/:id` | *project title* (Video tab) | The newest video, the timeline of renders, launching, the script chat | Launch draft | Launch a draft below |
| `/projects/:id/script` | Script tab | Lines with their emotion, the editor, earlier versions | Save as new version | Write or paste the script |
| `/projects/:id/export` | Export tab | Pick a render, platform preset, caption, AI label | Create export, then Download MP4 | Render a video first |
| `/library` | Library | Saved inspiration, search by meaning, ask, ideas | Save | Save your first piece |
| `/library/:id` | *item title* | The item on one time axis, its analysis and transcript | Make something from it (ideas, a remix, scripts) | Reading… (progress) |
| `/actors` | Actors | The 30 actors: picture, voice, style | — | — |
| `/benchmark` | Compare | One script across several models; vote; adopt the winner | Adopt for project (gold) | Start a comparison from a project |
| `/settings` | Settings | Appearance, your data, models, script chat, provider accounts | Each section's Save / Test | — |
| `/access` | Your private studio | Self-hosted only: the access code | Open studio | — |
| any other | Page not found | — | Back to your projects | — |

## The first video, whichever edition

Projects (empty) → **New project** → platform, format, language, actor →
**Create project** opens the Script tab → write three lines → **Save as new
version** → **Launch a render** (Video tab) → the video plays → **Export** →
**Download MP4**. About two minutes; the landing page's tour follows the same
path.

## Words

| Say | Not |
|---|---|
| project | experiment, job |
| render (a video made from a script version); draft until exported, final after | generation, clip (in the UI) |
| launch a render / Launch draft | generate, submit |
| script, script version, line, emotion | prompt (in the UI) |
| script chat (on a project), library chat (in the library) | assistant, AI |
| proposal, Apply & relaunch | suggestion |
| actor (in the docs, "actor preset" where it matters that a model only approximates the look) | avatar, character |
| model (video model, chat model), local / cloud | provider (except "provider account": where an API key belongs) |
| Compare, comparison | benchmark, run (in the UI) |
| export, Download MP4 | publish, share |
| library, item, idea | board, asset |
| self-hosted studio, browser edition | server version, web version, the word for a cut-down trial |
| Settings | My studio, preferences |

Buttons name their action with a verb and an object ("Create project",
"Save as new version", "Download MP4"); a step that moves on says
"Continue". Errors say what happened and what to do next, in one or two
plain sentences.

## Components

All in `src/app/_components` and shared by both editions:

- `Button` / `ButtonLink` (`ui.tsx`): **primary** (cobalt, one per view),
  **secondary** (hairline outline), **quiet** (text), **danger**, and
  `SpotButton` (gold, only when a human decision is awaited).
- `Chip` styles for single choices (platform, format, language, emotion,
  filters); `Field` styles for inputs, selects and text areas.
- `PageHeader` (Bricolage title), `ProjectHeader` + `ProjectTabs`,
  `Section`.
- `EmptyState` (teaches the next step), `Skeleton` shaped like what loads,
  `ErrorNote` (danger), `ProviderWarning` (warning), `NeedsSelfHosted`.
- `StatusChip` / `StageChip`, `ProgressBar` (the one glowing motion),
  `ActorPortrait`, `VideoPoster`.
- Icons from `icons.tsx`: one 20 px grid, 1.6 stroke, round caps; no
  Unicode arrows standing in for icons.

## Patterns

- **Loading**: a skeleton in the shape of what is coming (poster cards,
  rows, panels); never a spinner in the middle of content.
- **Empty**: what this place is for and the one action that fills it.
- **Error**: `ErrorNote` with the cause and the way out; a failed render
  says whether it is safe to try again (paid models are never resubmitted by
  themselves).
- **Limits**: a model's limits are a `ProviderWarning` shown before any
  call.

## CLI

The CLI (`troupe`, [CLI.md](CLI.md)) uses the same nouns: `projects`,
`script`, `chat`, `render`, `export`, `download`, `actors`, `models`,
`keys` (provider accounts), `library`. Comparing models is a studio page
only.
