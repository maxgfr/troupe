# The inspiration library

Save the videos, posts, articles, sound, pictures and PDFs that inspire you;
Troupe reads them with your own models, makes them searchable by meaning,
answers questions about them with citations, and turns what works into
scripts and projects. Everything runs on your machine: no account, no
credits, no cloud call unless you chose Claude for the chat.

- [What it does](#what-it-does)
- [Self-hosted studio](#self-hosted-studio)
- [Browser edition](#browser-edition)
- [Settings](#settings)
- [From the terminal](#from-the-terminal)
- [How search works](#how-search-works)
- [Security](#security)
- [Your rights to what you save](#your-rights-to-what-you-save)
- [Not done yet](#not-done-yet)

## What it does

**Save.** On the Library page (top bar), paste a link or a text, or drop
files. A link to a video platform (YouTube, TikTok, Instagram, Vimeo, X…) is
downloaded with yt-dlp; any other link is fetched once and kept as an article
(its words, without the page around it), or as a file when it points at a
video, sound, picture or PDF. Tick "It is my own content" for your own work.

**Read.** Each item is analysed in the background, one at a time:

| Step | Self-hosted studio | Browser edition |
|---|---|---|
| Pictures | ffmpeg: the opening frame and one after each cut (scene detection) | a video element and a canvas: cuts from frame differences every half second |
| Transcript | faster-whisper on the stack's renderer | Whisper (Transformers.js) in a worker |
| What the pictures show, on-screen text | a vision model on Ollama (`qwen3-vl:2b-instruct`) | not yet: no vision model small enough runs in a tab; the item says so |
| Hook, structure, tone, tags, summary | the script chat's model (Ollama or Claude) | the script chat's model (WebLLM, needs WebGPU) |
| Pace | words a second, cuts a minute | the same |
| Search index | an embedding model on Ollama (`qwen3-embedding:0.6b`) | multilingual-e5-small in a worker |

The hook is what is said in the first three seconds (whole phrases), or a
text's first line. A tool that is missing or fails skips its step and says
why ("Skipped: what the pictures show. Ollama does not have
qwen3-vl:2b-instruct yet…"); the item stays usable, and **Read it again**
reruns the analysis once the tool is there. Passages saved while the
embedding model was missing are indexed as soon as it arrives.

**Item page.** The player, then the item on one time axis: the hook, body
and call to action as bands, the pictures at their seconds, and a scrubber;
clicking any of them seeks the player. Below: the hook and why it works, the
summary, the structure with its times, pace, tone and tags, what the pictures
show, how each step went, and the transcript (click a time to seek).

**Search** (the field above the table) ranks passages by meaning; a hit
opens its item at its moment.

**Ask.** The chat beside the list answers from the whole library; the one on
an item's page from that item. Every answer cites the passages it used as
`[1]`, `[2]`; a citation opens the item at that moment.

**Make.** On an item: **10 ideas in this style** (new subjects, the same
kind of hook, structure and pace), **Remix the hook** (five openings that
work the same way), **Cut into short scripts** (a long item into three) and
**A script for one actor**. Each idea card is a whole script, lines with
roles and emotions; **Create project** makes a project (TikTok 9:16 by
default, the idea's language, its actor or the first available) with that
script as version 1, ready to render. The browser edition's small model
writes five ideas at a time, and now and then an answer that is not a script
(about one try in five in testing): try again.

**In your voice.** Items marked as your own content give a short style
profile (the hooks you open with, your tone, your pace, your sentence
length). It goes with every request the library's chat and ideas make, and
with the project's script chat.

## Self-hosted studio

The Docker stack has it all on by default:

- the `renderer` service transcribes (`WHISPER_ENABLED=1` in its image;
  faster-whisper base, 145 MB, downloads into its volume on first use);
- the `ollama` service pulls the search and vision models **after** the
  chat model, in the background: the stack is healthy as soon as the chat
  model is there, and the library says what it is still waiting for
  (`qwen3-embedding:0.6b` is 639 MB, `qwen3-vl:2b-instruct` 1.9 GB);
- the app image carries yt-dlp (build with `--build-arg TROUPE_YTDLP=0` to
  leave it out; links to platforms are then refused with the reason).

Originals live in the data volume (`library/<item>/`), next to the renders.
`troupe doctor` checks each tool.

Outside Docker (`pnpm dev`):

```bash
pnpm renderer:whisper:setup            # uv environment + the Whisper model
pnpm renderer:whisper                  # the renderer with /transcribe
ollama pull qwen3-embedding:0.6b       # search by meaning
ollama pull qwen3-vl:2b-instruct       # what the pictures show (optional)
brew install yt-dlp                    # video links (optional; or pipx install yt-dlp)
```

and in `.env`: `TROUPE_TRANSCRIBE_URL=http://127.0.0.1:8078`. ffmpeg and
ffprobe must be on the PATH. On Vercel the library keeps texts and articles
only: originals are kept on your own server, so uploads need the self-hosted
studio.

## Browser edition

The same pages, with everything in the tab: files stay in this browser
(IndexedDB, in the backups), Whisper base and multilingual-e5-small run in a
worker on the CPU (about 195 MB, downloaded once from Hugging Face and kept
in Cache Storage), and the analysis runs in one tab at a time. Without a
server there is no link fetching (save the video or page to a file and
upload it, or paste the text) and no vision model; the chat, the analysis's
writing and the ideas need WebGPU, like the script chat. `VITE_LIBRARY_*`
variables change the models (`site/.env.example`).

## Settings

Self-hosted (`.env.example`; every one is optional):

| Variable | Default | What |
|---|---|---|
| `TROUPE_LIBRARY` | `1` | `0` turns the library off (and the stack pulls none of its models). |
| `TROUPE_LIBRARY_EMBED_MODEL` | `qwen3-embedding:0.6b` | Ollama embedding model; `off` keeps search on keywords. Changing it re-indexes the library in the background. |
| `TROUPE_LIBRARY_VISION_MODEL` | `qwen3-vl:2b-instruct` | Ollama vision model; `off` skips the step. |
| `TROUPE_LIBRARY_OLLAMA_URL` | `OLLAMA_URL` | Another Ollama for these two. |
| `TROUPE_LIBRARY_OLLAMA_TIMEOUT_S` | `300` | Per request. |
| `TROUPE_TRANSCRIBE_URL` | unset (`http://renderer:8078` in Docker) | The renderer that transcribes; unset, videos are not transcribed. |
| `TROUPE_TRANSCRIBE_TOKEN` | `TROUPE_RENDERER_TOKEN` | Its token. |
| `TROUPE_TRANSCRIBE_TIMEOUT_S` | `1800` | Per file. |
| `TROUPE_LIBRARY_MAX_UPLOAD_MB` | `500` | Largest upload or download. |
| `TROUPE_LIBRARY_MAX_DURATION_S` | `3600` | Longest video yt-dlp downloads. |
| `TROUPE_LIBRARY_FRAMES` | `12` | Pictures taken from a video. |
| `TROUPE_LIBRARY_VISION_FRAMES` | `6` | Of those, how many the vision model reads (about 10 to 20 s each on a laptop CPU). |
| `TROUPE_LIBRARY_FETCH_TIMEOUT_S` | `60` | Fetching a page. |
| `TROUPE_LIBRARY_ALLOW_PRIVATE_URLS` | `0` | `1` also fetches links to this machine and your network (never link-local or cloud metadata addresses). |
| `TROUPE_YTDLP_PATH` | `yt-dlp` | The yt-dlp program. |
| `FFMPEG_PATH` | `ffmpeg` | The ffmpeg program (`FFPROBE_PATH` for ffprobe). |

The renderer's own (`renderer/`, docker-compose.yml `TROUPE_WHISPER_*`):
`WHISPER_ENABLED`, `WHISPER_MODEL` (`base`; `tiny`, `small`, `medium`,
`large-v3`, `turbo`), `WHISPER_COMPUTE_TYPE` (`int8`), `WHISPER_DEVICE`
(`cpu`, or `cuda`), `WHISPER_LANGUAGE` (detected when unset),
`WHISPER_THREADS`, `WHISPER_TIMEOUT_S` (`1800`), `WHISPER_MAX_MB` (`300`),
`WHISPER_COMMAND`.

The writing model is the script chat's (Settings > Script chat): its
provider, model and house style apply to the library too.

## From the terminal

```bash
troupe library add clip.mp4 --wait          # a file; --mine for your own
troupe library add https://youtu.be/… --wait
pbpaste | troupe library add - --title "Notes"
troupe library list --kind video
troupe library show "Cold open" --transcript
troupe library search hooks that ask a question
troupe library chat which of these opens on a dare?
troupe library chat --item 3f2a why does this hook work?
troupe library ideas generate --item 3f2a                    # 10 in its style
troupe library ideas generate --item 3f2a --kind script --actor Maya
troupe library ideas                                          # the cards
troupe library ideas project 9c1e --platform instagram        # → a project
```

Every command takes `--json` (docs/CLI.md). The Claude skill uses them
(docs/CLAUDE-SKILL.md).

## How search works

Each passage's embedding is stored as a `real[]` column and compared by
cosine similarity in the studio (`src/modules/library/text.ts`), exactly,
against every passage of the workspace. pgvector was the alternative: its
exact search is the same brute force, its HNSW index only pays off well past
the tens of thousands of passages a personal library holds, and it needs an
extension in every database: a different Postgres image for the Docker stack
(Debian-based, which changes the collation of an existing data volume),
`CREATE EXTENSION` rights on a database you bring yourself, and the vector
extension loaded into PGlite in the browser and the tests. Plain arrays work
unchanged on all of them, and in backups. Passages not read by the current
embedding model yet are matched by keywords, and the result says so.

## Security

- **Links** are fetched only from public addresses: the address as written
  and every address its name resolves to, at connection time (so a name that
  points at a private address, or changes its answer, is refused), at every
  redirect (followed by hand, at most five). Loopback, private networks,
  link-local, multicast, cloud metadata hosts and odd ports are refused
  (`TROUPE_LIBRARY_ALLOW_PRIVATE_URLS=1` lets your own network in). Pages are
  limited to 5 MB and parsed with linkedom: nothing in them runs.
- **Files** are streamed to disk with a size limit and named by their first
  bytes, never by their name or the type the browser claimed: video, sound,
  PNG, JPEG, WebP, GIF, PDF or plain text; HTML, SVG and anything else are
  refused. They are served with `nosniff`, a sandboxing CSP, and only media
  and pictures inline.
- **Programs** (ffmpeg, ffprobe, yt-dlp, Whisper) run with argument lists,
  never a shell, with time limits; the link is one argument after `--`.
  yt-dlp loads no configuration or plugins, refuses playlists, caps size and
  length, and gets only `PATH`, `HOME` and `LANG` from the studio's
  environment. Temporary files live in folders of their own, removed after.
- **Rows**: every library table has row level security (members of the
  workspace only), and every item, idea and message id is checked against the
  caller's workspace.

## Your rights to what you save

The library analyses what **you** give it: files you upload and links you
paste, one at a time. It does not crawl, follow links or import channels, and
it keeps originals on your own server (or in your own browser), never
anywhere else. You are responsible for having the right to download and use
what you save; many platforms' terms forbid downloading, and copyright still
applies to what you learn from. Ideas are written in a style, not copied:
the prompts ask for new words, but check what you publish.

## Not done yet

Recorded honestly as future work, not promised:

- Visual boards (an infinite canvas with parallel chat threads and pages).
- Carousel generation, and motion graphics over your own footage.
- A browser extension for one-click saving.
- Importing a whole channel or playlist (one link at a time today; a loop of
  `troupe library add` is the way for now).
- A vision model in the browser edition, when one small enough runs well on
  WebGPU.
- Credits or pricing: there are none, and there will be none.
