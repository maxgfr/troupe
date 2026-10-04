# Script chat

The project page has a chat beside the timeline (a sheet opened with **Chat**
on a phone). Ask for a change in plain words ("a punchier hook", "calmer",
"use Marcus instead"); the model answers with a whole new version of the
script, shown line by line against the current one. Nothing changes until you
choose:

- **Apply only** adds it as the project's newest script version, with origin
  `chat`, keeping the roles and emotions the model gave each line. When the
  proposal names another actor, the project is recast too.
- **Apply & relaunch** does the same, then launches a draft of the new
  version with the newest render's model, length and resolution (or the
  launch panel's model and its defaults before the first render). A proposal
  too long for that model's longest clip cannot be relaunched; the button
  says why.

A proposal asked on an older version says so ("Written for version 3; the
script is now version 5") before you apply it. Applying the same proposal
twice returns the version it already made.

## How an answer is made

`src/modules/chat` builds a short prompt: the project, the actor, the current
lines, the emotions and roles allowed, the other actors, the studio's house
style, the last few turns, and a **word budget**: the clip's seconds times the
speaking rate (2.5 words a second by default, the same rate as the script's
duration estimate). The model must answer with a JSON object that follows a
schema (`summary`, every `lines` entry with its `role`, `text` and
`emotion`, and an `actor` or null), enforced by the provider where it can
(Ollama's `format`, Claude's structured outputs, WebLLM's `response_format`),
then checked again with zod. An answer that is not valid, or is over the word
budget, gets one more try with the problem spelled out. If that fails too, the
chat shows what the model wrote, and an over-budget script is kept with its
length marked.

The conversation is stored in `troupe_chat_message` (migration
`drizzle/0018_chat.sql`), readable only by the project's workspace members.

## Providers

| Where | Provider | Default model | Set up |
|---|---|---|---|
| Self-hosted | [Ollama](https://ollama.com), on your computer or network | `qwen3:4b` (2.5 GB) | `ollama pull qwen3:4b`, then keep `ollama serve` (or the app) running |
| Self-hosted | Claude, with your Anthropic API key | `claude-opus-5-5` | Settings → Provider accounts, or `ANTHROPIC_API_KEY` |
| Static demo | [WebLLM](https://github.com/mlc-ai/web-llm), in the visitor's tab on the GPU | `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` (880 MB) | nothing: downloaded once per browser on the first request |

In the self-hosted studio the chat uses Claude when an Anthropic key is saved
(or set in the environment) and Ollama otherwise; Settings → Script chat can
pin either. Each message to Claude is billed by Anthropic. The demo offers
only WebLLM: a page on the web can neither keep an API key nor reach an Ollama
on the visitor's machine. It needs WebGPU (a recent Chrome or Edge on a
computer with a GPU); elsewhere the chat explains why it is off.

### Ollama from Docker

The Compose file points the app at `http://host.docker.internal:11434`, the
Ollama on the computer running Docker. Docker Desktop (macOS, Windows) reaches
it as it is. On Linux, Ollama listens on 127.0.0.1 only: start it with
`OLLAMA_HOST=0.0.0.0` (or set its systemd service's environment) so the
container can reach it, and keep the port closed to your network otherwise.
Under `pnpm dev` the default `http://127.0.0.1:11434` works.

Any Ollama model that can follow a JSON schema works; small ones (1–4 B
parameters) answer in a few seconds on a laptop. Settings → Script chat →
**Test** checks that Ollama answers and has the model.

## Settings

Saved in Settings → Script chat (they override the environment); blank fields
use the defaults below.

| Self-hosted (`.env`) | Default | |
|---|---|---|
| `TROUPE_CHAT_PROVIDER` | `auto` | `auto`, `ollama` or `anthropic` |
| `OLLAMA_URL` | `http://127.0.0.1:11434` (Compose: `http://host.docker.internal:11434`) | private and loopback addresses are fine; cloud metadata and link-local ones are refused |
| `OLLAMA_MODEL` | `qwen3:4b` | |
| `ANTHROPIC_API_KEY` | — | a key saved in Settings takes precedence |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | current models get a low effort level and Anthropic's server-side fallback on a declined request; other ids are sent without either |
| `TROUPE_CHAT_INSTRUCTIONS` | — | the house style, added to every request |
| `TROUPE_CHAT_WORDS_PER_SECOND` | `2.5` | the word budget's rate, 1 to 5 |
| `TROUPE_CHAT_TIMEOUT_S` | `180` | how long one answer may take |

| Static demo (`site/.env`, at build time) | Default | |
|---|---|---|
| `VITE_WEBLLM_MODEL` | `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` | a WebLLM prebuilt model id; the build stops on one WebLLM does not know. GPUs without `shader-f16` get the `q4f32` build of the same model when there is one |
| `VITE_WEBLLM_DOWNLOAD_MB` | `880` for the default model | the size shown before the first request (0 hides it) |
| `VITE_CHAT_INSTRUCTIONS`, `VITE_CHAT_WORDS_PER_SECOND` | —, `2.5` | defaults for the demo's Settings |

## Testing

`pnpm test` covers the prompt, the checks and the repair, applying (origin
`chat`, roles and emotions kept, row-level security), the router against a
fake Ollama over HTTP and the Anthropic SDK against a fake API server: no real
key or paid call. `pnpm site:test:chat` (after `pnpm site:build`) runs the
demo's chat for real in headed Chrome: a request, Apply, then Apply &
relaunch rendered in the tab. It needs WebGPU and downloads the chat model
into the render test's browser profile once, so it runs locally, not in CI.
