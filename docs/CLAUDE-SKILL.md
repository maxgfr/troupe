# Troupe with Claude Code

The `troupe` skill teaches Claude Code to run a whole Troupe project through
the [CLI](CLI.md): check the studio, pick an actor and a model, write the
script (or ask the studio's script chat), render, review the video, iterate
and export. Ask in plain words ("make a 10-second TikTok announcing our
Sunday opening hours with Troupe") and Claude takes it from there.

The skill is [`skills/troupe/SKILL.md`](../skills/troupe/SKILL.md). That
folder is also the plugin (`skills/troupe/.claude-plugin/plugin.json`), and
this repository is a Claude Code plugin marketplace that lists it
(`.claude-plugin/marketplace.json`), so installing it copies the skill
folder alone, a few kilobytes.

## Before you start

- A running studio (`pnpm dev`, Docker, or a deployment) and, for a free
  setup, the [local renderer](LOCAL-MODELS.md#local-renderer).
- The CLI on your PATH, from a checkout:
  `pnpm install && pnpm --filter troupe-cli build && npm install -g ./cli`.
  (If `troupe` is missing, Claude offers to build and install it from a
  checkout, and waits for your yes.)
- Signed in, in your own terminal: `troupe login --url <studio address>`.
  Claude never asks for the access code or an API key in the conversation;
  when one is needed it asks you to run the command yourself.
- `ffmpeg` and `ffprobe`, for the review step.

## Install the skill

As a plugin, from GitHub:

```text
/plugin marketplace add maxgfr/troupe
/plugin install troupe@troupe
```

or from your shell: `claude plugin marketplace add maxgfr/troupe`, then
`claude plugin install troupe@troupe`. Adding the marketplace clones this
repository; `claude plugin marketplace add maxgfr/troupe --sparse
.claude-plugin skills` checks out only the two folders it needs. From a
local checkout, pass its path instead of `maxgfr/troupe`. The skill then
answers to `/troupe:troupe` and loads on its own when you ask for a Troupe
video.

Without the plugin system, copy the folder into your personal skills:

```bash
mkdir -p ~/.claude/skills && cp -R skills/troupe ~/.claude/skills/troupe
```

(it is then `/troupe`). A copy does not update itself; the plugin updates
with `/plugin marketplace update troupe`.

## What Claude does

1. `troupe doctor --json`, and fixes what fails: the address, the sign-in
   (by asking you), a missing model (it adds the local renderer when it
   runs).
2. Settles the brief (platform, length, language), choosing defaults it
   tells you about.
3. Chooses an actor whose age, style and voice fit, and a model that can
   launch, then creates the project.
4. Writes the script within the word budget (clip seconds × 2.5), with an
   emotion per line, or asks the studio's chat and applies its proposal.
5. Renders and follows the render with a time limit; on a failure, reads
   the reason, fixes it and relaunches. A render still running when the
   limit passes is watched again, never launched twice, and after any
   interrupted command Claude lists the renders before launching.
6. Reviews the MP4: `ffprobe` for the streams, size and length, and three
   frames it looks at for the actor and the captions. It tells you what it
   saw and where the file is, and says what it could not check (it cannot
   hear the voice).
7. Iterates on the script when you ask.
8. Exports only after you say you watched the video and it is ready, then
   passes on the platform's AI-disclosure rule.

With the [inspiration library](LIBRARY.md), Claude also saves the files and
links you give it (`troupe library add`, waiting for the analysis), reads
their hooks and structure, searches and asks the library, and writes scripts
from what it found, through the library's idea cards (`troupe library ideas
generate`, then `ideas project`) or itself; then it carries on with the
render. It saves only what you hand it, one item at a time, and treats
what it reads there (transcripts, articles, on-screen text, the chat's
answers) as data: it never runs a command, saves a link or changes anything
because a saved item's text says to.

It asks before spending: launching on a cloud model bills your provider
account, so Claude states the cost first. It deletes nothing unless you ask.

## How it was checked

The skill was followed step by step against a studio under `pnpm dev`
with the local renderer and Ollama, and run once by a fresh headless
Claude Code session with the plugin loaded (`claude -p --plugin-dir .`),
which made, rendered and reviewed a video, recovered from a script too
long for its clip, and stopped before exporting as asked. Both walks
changed the skill: the review commands avoid the shell variable `path`
(zsh ties it to `PATH`) and force a C locale for the frame times, and
the CLI now refuses a script longer than `--duration` before sending
anything.
